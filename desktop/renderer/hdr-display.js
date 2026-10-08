import { convertHDRColor } from './hdr-color.js';
import { linearToSrgb } from './hdr-pixels.js';

export function displayPixels(source, exposure = 0) {
  const converted = convertHDRColor(source, source.linearSpace ?? 'Linear sRGB', 'Linear P3-D65'), data = converted.data.slice(), gain = 2 ** exposure;
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = Math.max(-65504, Math.min(65504, data[i + c] * gain));
  return { ...converted, data };
}
export function extendedSRGB(value) { return Math.sign(value) * linearToSrgb(Math.abs(value)); }
export const HDR_SHADER = `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<uniform> size: vec4f;
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let points = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return vec4f(points[index], 0, 1);
}
fn encode(v: f32) -> f32 { let a = abs(v); return sign(v) * select(1.055 * pow(a, 1.0/2.4) - 0.055, 12.92 * a, a <= 0.0031308); }
@fragment fn fragment(@builtin(position) point: vec4f) -> @location(0) vec4f {
  let dimensions = textureDimensions(image); let xy = min(vec2u(point.xy), dimensions - vec2u(1)); let pixel = textureLoad(image, vec2i(xy), 0);
  let cell = vec2u(point.xy / vec2f(dimensions) * size.xy / 12.0); let background = select(0.66, 0.82, (cell.x + cell.y) % 2u == 0u);
  let color = pixel.rgb * pixel.a + vec3f(background) * (1.0 - pixel.a);
  return vec4f(encode(color.r), encode(color.g), encode(color.b), 1);
}`;
export class HDRDisplay {
  constructor(editor, environment = {}) {
    this.editor = editor; this.gpu = environment.gpu ?? navigator.gpu; this.highRange = environment.highRange ?? (() => matchMedia('(dynamic-range: high)').matches); this.active = false; this.state = 'SDR';
    this.canvas = document.createElement('canvas'); this.canvas.className = 'hdr-display'; this.canvas.hidden = true; this.canvas.setAttribute('aria-hidden', 'true'); editor.display.after(this.canvas);
    this.canvas.style.cssText = 'position:absolute;pointer-events:none;max-width:none;max-height:none;';
    matchMedia('(dynamic-range: high)').addEventListener('change', () => { this.state = 'SDR'; this.editor.draw(); });
  }
  description() { return this.active ? 'Extended HDR output is active. Preview exposure changes brightness; SDR tone mapping is bypassed.' : 'HDR output requires an HDR display and extended WebGPU canvas support. Unsupported devices use an SDR preview.'; }
  async initialize() {
    if (this.pending || this.device || this.state === 'Unavailable') return; this.pending = true;
    try {
      const adapter = await this.gpu?.requestAdapter(), device = await adapter?.requestDevice(); if (!device) throw new Error('No HDR graphics device.');
      const context = this.canvas.getContext('webgpu'); if (!context?.getConfiguration) { device.destroy(); throw new Error('No HDR canvas.'); }
      context.configure({ device, format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT, colorSpace: 'display-p3', alphaMode: 'opaque', toneMapping: { mode: 'extended' } });
      const configuration = context.getConfiguration(); if (configuration?.toneMapping?.mode !== 'extended' || configuration.format !== 'rgba16float') { context.unconfigure(); device.destroy(); throw new Error('No extended canvas.'); }
      device.pushErrorScope('validation'); const shader = device.createShaderModule({ code: HDR_SHADER });
      const bindings = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
      const pipeline = await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [bindings] }), vertex: { module: shader, entryPoint: 'vertex' }, fragment: { module: shader, entryPoint: 'fragment', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
      const error = await device.popErrorScope(); if (error) { context.unconfigure(); device.destroy(); throw new Error(error.message); }
      this.device = device; this.context = context; this.pipeline = pipeline; this.uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); this.state = 'Ready';
      device.addEventListener('uncapturederror', (event) => { event.preventDefault(); this.state = 'Unavailable'; this.active = false; this.canvas.hidden = true; this.editor.update(false); });
      device.lost.then(() => { this.texture?.destroy(); this.device = null; this.state = 'Unavailable'; this.active = false; this.canvas.hidden = true; this.editor.update(false); });
    } catch { this.state = 'Unavailable'; this.active = false; this.canvas.hidden = true; }
    finally { this.pending = false; this.editor.draw(); }
  }
  update(preview) {
    const source = preview?.compositorHDR, mode = this.editor.manifest?.hdrView?.displayMode ?? 'Auto';
    if (!source || mode === 'SDR' || !this.highRange() || this.state === 'Unavailable') { this.active = false; this.canvas.hidden = true; return; }
    if (!this.device) { this.initialize(); return; }
    try {
      const pixels = displayPixels(source, this.editor.manifest.hdrView?.exposure ?? 0), { width, height } = pixels;
      if (!this.texture || this.texture.width !== width || this.texture.height !== height) { this.texture?.destroy(); this.texture = this.device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }); }
      this.canvas.width = width; this.canvas.height = height; const size = [this.editor.manifest.width * this.editor.zoom, this.editor.manifest.height * this.editor.zoom];
      Object.assign(this.canvas.style, { left: this.editor.pan.x + 'px', top: this.editor.pan.y + 'px', width: size[0] + 'px', height: size[1] + 'px' });
      this.device.queue.writeTexture({ texture: this.texture }, pixels.data, { bytesPerRow: width * 16 }, [width, height]); this.device.queue.writeBuffer(this.uniform, 0, new Float32Array([...size, 0, 0]));
      const bind = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.texture.createView() }, { binding: 1, resource: { buffer: this.uniform } }] }), encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }); pass.setPipeline(this.pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end(); this.device.queue.submit([encoder.finish()]);
      this.active = true; this.canvas.hidden = false; this.canvas.dataset.output = 'HDR';
    } catch { this.active = false; this.canvas.hidden = true; this.state = 'Unavailable'; }
  }
}
