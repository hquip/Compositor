import { test, expect, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('precision PSD reference delivery uses independent Photoshop-compatible parser', async () => {
  test.skip(!process.env.COMPOSITOR_PSD_REFERENCE_DIR, 'A development reference-output directory is required.');
  const server = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: fileURLToPath(new URL('../../mobile/', import.meta.url)), windowsHide: true, stdio: 'pipe' });
  let browser;
  try {
    await new Promise((resolve) => server.stdout.once('data', resolve)); browser = await chromium.launch(); const page = await browser.newPage(); await page.goto('http://127.0.0.1:4173'); await expect(page.locator('html')).toHaveAttribute('data-mobile-ready', 'true');
    const files = await page.evaluate(async () => {
      const { editor:e }=await import('./app.js'),{surface}=await import('./raster.js'),{writePsd}=await import('./vendor/psd.js'),{buildPhotoshop,binaryBase64}=await import('./psd-export.js'),{patchPhotoshopDepth,precisionPhotoshopSources}=await import('./photoshop-precision-export.js'),{encodeChannelSource}=await import('./channel-source.js'),{addResource}=await import('./workflow-assets.js'),{profileBytes}=await import('./color-engine.js');const result=[];
      for(const bits of [16,32])for(const psb of [false,true]){e.newCanvas(2,1);const image=surface(2,1);image.getContext('2d').fillStyle='#808080';image.getContext('2d').fillRect(0,0,2,1);e.storePixels(e.active,image);const source={width:2,height:1,channels:4,mode:'RGB',bits,data:new Float32Array([bits===16?12345/65535:1.25,.5,.25,1,.25,.5,bits===16?43210/65535:.00123,.5])};e.active.workflow={type:'channels',channelFile:addResource(e,encodeChannelSource(source),'channels'),bits,mode:'RGB'};e.manifest.workflow={colorMode:'RGB',bits};const base=new Uint8Array(writePsd(buildPhotoshop(e),{psb,generateThumbnail:false})),bytes=patchPhotoshopDepth(base,precisionPhotoshopSources(e),source,'RGB',bits,await profileBytes('sRGB'));result.push({name:`rgb-${bits}.${psb?'psb':'psd'}`,data:binaryBase64(bytes)});}return result;
    });
    await mkdir(process.env.COMPOSITOR_PSD_REFERENCE_DIR, { recursive: true });
    for (const file of files) await writeFile(process.env.COMPOSITOR_PSD_REFERENCE_DIR + '/' + file.name, Buffer.from(file.data, 'base64'));
  } finally { await browser?.close(); server.kill(); }
});
