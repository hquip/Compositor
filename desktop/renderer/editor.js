import { createManifest, createLayer, History, localPoint, documentPoint, unsupportedFeatures, MAX_PIXELS, MAX_SIDE, FORMAT_VERSION, documentPixels } from './core.js';
import { compose, surface, decodeAssets, decodeImage } from './compose.js';
import { followLinkedMasks, following } from './affine.js';
import { drawSelectionOutline } from './selection-contour.js';
import { deleteLayers, reorderLayer } from './clipping.js';
import { renderText } from './text-layout.js';
import { rasterTarget, mappedSelection, maskedChange, maskToPixels, pixelsToMask, resizedGrid } from './raster-space.js';
import { storeMask } from './masks.js';
import { penResponse } from './pen-input.js';
import { filterAssetNames } from './filter-mix.js';
import { composeHDRCanvas } from './hdr-layer.js';

export class Editor {
  constructor(viewport, display, overlay, onChange) {
    this.viewport = viewport; this.display = display; this.overlay = overlay; this.onChange = onChange;
    this.manifest = null; this.assets = {}; this.images = new Map(); this.masks = new Map(); this.history = new History();
    this.name = 'Untitled'; this.tool = 'move'; this.zoom = 1; this.pan = { x: 0, y: 0 }; this.selection = null;
    this.color = '#58a6ff'; this.brushSize = 40; this.brushHardness = 0.8; this.brushOpacity = 1;
    this.shapeKind = 'Rectangle'; this.spaceDown = false; this.gesture = null; this.busy = false;
    this.pixelBudget = MAX_PIXELS;
    this.preview = null; this.framePending = false;
    this.followsFit = true; this.viewSize = { width: viewport.clientWidth, height: viewport.clientHeight };
    new ResizeObserver(() => { const width = viewport.clientWidth, height = viewport.clientHeight; if (this.manifest && this.followsFit) this.fit(); else { this.pan.x += (width - this.viewSize.width) / 2; this.pan.y += (height - this.viewSize.height) / 2; } this.viewSize = { width, height }; this.draw(); }).observe(viewport);
    overlay.addEventListener('pointerdown', (event) => this.pointerDown(event));
    overlay.addEventListener('pointermove', (event) => this.pointerMove(event));
    overlay.addEventListener('pointerup', (event) => this.pointerUp(event));
    overlay.addEventListener('pointercancel', () => this.cancelGesture());
    overlay.addEventListener('lostpointercapture', () => { if (this.gesture) this.cancelGesture(); });
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.setZoom(this.zoom * Math.exp(-event.deltaY * 0.002), this.viewPoint(event));
      else { this.followsFit = false; this.pan.x -= event.deltaX; this.pan.y -= event.deltaY; this.draw(); }
    }, { passive: false });
  }

  get active() { return this.manifest?.layers.find((layer) => layer.id === this.manifest.activeLayerID); }
  snapshot() { const manifest = structuredClone(this.manifest); if (manifest) manifest.version = FORMAT_VERSION; return { manifest, assets: { ...this.assets }, selection: this.selection ? { ...this.selection } : null }; }
  projectSnapshot() {
    this.pathEditor?.finish(true);
    this.floatingSelection?.finish(true);
    this.gradient?.finish(true);
    if (this.inlineText?.finish(true) === false) throw new Error('Finish editing the text before saving.');
    const snapshot = this.snapshot();
    delete snapshot.selection;
    snapshot.manifest.version = FORMAT_VERSION;
    return snapshot;
  }
  update(invalidate = true) {
    if (invalidate) this.preview = null;
    this.onChange(); this.draw();
  }
  mutate(name, action, { followMasks = true } = {}) {
    if (!this.manifest || this.busy || this.gesture) return;
    const before = this.snapshot();
    const images = new Map(this.images), masks = new Map(this.masks);
    try { action(); if (followMasks) followLinkedMasks(this.manifest, before.manifest); }
    catch (error) {
      this.manifest = before.manifest; this.assets = before.assets; this.selection = before.selection;
      this.images = images; this.masks = masks; this.update();
      throw error;
    }
    const after = this.snapshot();
    const changed = JSON.stringify(before.manifest) !== JSON.stringify(after.manifest) || JSON.stringify(before.selection) !== JSON.stringify(after.selection) ||
      Object.keys(before.assets).length !== Object.keys(after.assets).length || Object.keys(after.assets).some((key) => before.assets[key] !== after.assets[key]);
    if (changed) this.history.push(before, after, name);
    this.update();
  }
  async install(snapshot, reset = false) {
    const unsupported = unsupportedFeatures(snapshot.manifest);
    if (unsupported.length) throw new Error(`This project uses ${unsupported.join(' and ')}, which are not yet supported by the Windows client. Open it in the Mac app to edit those features.`);
    const decoded = await decodeAssets(snapshot.manifest, snapshot.assets);
    this.manifest = structuredClone(snapshot.manifest); this.assets = { ...snapshot.assets };
    this.images = decoded.images; this.masks = decoded.masks; this.selection = snapshot.selection ?? null;
    this.selectedIDs = new Set(this.manifest.activeLayerID ? [this.manifest.activeLayerID] : []);
    if (!this.active?.maskFile) this.editMask = false;
    if (reset) this.history.reset();
    this.update();
  }
  newCanvas(width, height) {
    this.manifest = createManifest(width, height); this.assets = {}; this.images = new Map(); this.masks = new Map();
    this.selection = null; this.history.reset(); this.name = 'Untitled';
    const layer = createLayer('Layer 1', width, height);
    this.manifest.layers.push(layer); this.manifest.activeLayerID = layer.id;
    this.history.savedRevision = null;
    this.fit(); this.update();
  }
  async importImages(files) {
    const prepared = [];
    let usedPixels = documentPixels(this);
    for (const file of files) {
      const image = await decodeImage(file.data);
      const width = image.naturalWidth, height = image.naturalHeight;
      if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS || usedPixels + width * height > this.pixelBudget) {
        throw new Error(`This import exceeds the ${Math.round(this.pixelBudget / 1000000)}-megapixel document budget or the per-image limit.`);
      }
      usedPixels += width * height;
      const canvas = surface(width, height); canvas.getContext('2d').drawImage(image, 0, 0);
      prepared.push({ canvas, name: file.name });
    }
    if (!prepared.length) return;
    const wasEmpty = !this.manifest;
    if (wasEmpty) {
      this.manifest = createManifest(prepared[0].canvas.width, prepared[0].canvas.height);
      this.history.reset(); this.name = 'Untitled';
    }
    const before = this.snapshot();
    for (const file of prepared) {
      const layer = createLayer(file.name, file.canvas.width, file.canvas.height);
      const factor = Math.min(1, this.manifest.width / file.canvas.width, this.manifest.height / file.canvas.height);
      layer.transform.size = [Math.max(1, file.canvas.width * factor), Math.max(1, file.canvas.height * factor)];
      layer.transform.origin = [(this.manifest.width - layer.transform.size[0]) / 2, (this.manifest.height - layer.transform.size[1]) / 2];
      this.manifest.layers.push(layer); this.manifest.activeLayerID = layer.id;
      this.storePixels(layer, file.canvas);
    }
    this.history.push(before, this.snapshot(), 'Import Images');
    if (wasEmpty) this.fit();
    this.update();
  }
  storePixels(layer, canvas, { filterCache = false, vectorCache = false, channelCache = false } = {}) {
    if (layer.workflow?.channelFile && !channelCache) throw new Error('Edit this layer through Channels to preserve its authoritative color samples.');
    if (!filterCache && (layer.smartObject || layer.hdrSourceFile)) throw new Error('Edit the embedded content or rasterize this protected layer before painting its pixels.');
    if (!vectorCache) delete layer.vectorPath;
    if (!filterCache && layer.filterSourceFile && atob(this.assets[layer.filterSourceFile].slice(0, 44)).charCodeAt(24) === 16) throw new Error('Rasterize this high-precision layer before changing its pixels, or paint on a new layer.');
    const data = canvas.toDataURL('image/png');
    if (data === 'data:,') throw new Error('Could not encode image pixels. Try a smaller image.');
    if (!filterCache && layer.filterSourceFile) delete this.assets[layer.filterSourceFile];
    if (!filterCache) for (const name of filterAssetNames(layer)) delete this.assets[name];
    delete layer.filters; delete layer.filterSourceFile; delete layer.filterWorkingSpace;
    layer.imageFile = `${layer.id}.png`;
    canvas.compositorRevision = (canvas.compositorRevision ?? 0) + 1;
    this.assets[layer.imageFile] = data.split(',')[1]; this.images.set(layer.id, canvas);
  }
  rasterize(layer) { delete layer.text; delete layer.shape; delete layer.vectorPath; }
  select(id) { if (!this.busy && !this.gesture) { this.manifest.activeLayerID = id; this.update(false); } }
  addLayer() {
    this.mutate('New Layer', () => {
      const layer = createLayer(`Layer ${this.manifest.layers.length + 1}`, this.manifest.width, this.manifest.height);
      layer.parentID = this.active?.parentID;
      this.manifest.layers.push(layer); this.manifest.activeLayerID = layer.id;
    });
  }
  duplicate() {
    const active = this.active;
    if (!active || active.isGroup) return;
    this.mutate('Duplicate Layer', () => {
      const copy = structuredClone(active); copy.id = crypto.randomUUID().toUpperCase(); copy.name += ' copy';
      if (active.imageFile) { copy.imageFile = `${copy.id}.png`; this.assets[copy.imageFile] = this.assets[active.imageFile]; this.images.set(copy.id, this.images.get(active.id)); }
      if (active.maskFile) { copy.maskFile = `${copy.id}.mask.png`; this.assets[copy.maskFile] = this.assets[active.maskFile]; this.masks.set(copy.id, this.masks.get(active.id)); }
      this.manifest.layers.splice(this.manifest.layers.indexOf(active) + 1, 0, copy); this.manifest.activeLayerID = copy.id;
    });
  }
  async deleteLayer() { await deleteLayers(this); }
  reorder(direction) {
    reorderLayer(this, direction);
  }
  async restore(action) {
    if (this.busy || this.gesture) return;
    const snapshot = action === 'undo' ? this.history.undo() : this.history.redo();
    if (snapshot) await this.install(snapshot);
  }
  applyFilter(name) {
    const layer = this.active, mask = this.editMask, image = layer && (mask ? rasterTarget(this, layer, true).source : this.images.get(layer.id));
    if (!image || layer.isGroup && !mask) return;
    this.mutate(name, () => {
      const canvas = surface(image.width, image.height), ctx = canvas.getContext('2d');
      if (name === 'Blur') ctx.filter = 'blur(4px)';
      ctx.drawImage(mask ? maskToPixels(image) : image, 0, 0); ctx.filter = 'none';
      if (name === 'Invert' || name === 'Grayscale') {
        const pixels = ctx.getImageData(0, 0, image.width, image.height);
        for (let i = 0; i < pixels.data.length; i += 4) if (name === 'Invert') { for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] = 255 - pixels.data[i + channel]; }
        else { const gray = Math.round(pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722); pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray; }
        ctx.putImageData(pixels, 0, 0);
      }
      let output = mask ? pixelsToMask(canvas) : canvas;
      if (this.selection) output = maskedChange(image, output, mappedSelection(this, mask ? { ...layer, transform: layer.maskPlacement ?? layer.transform } : layer, image.width, image.height));
      if (mask) storeMask(this, layer, output); else { this.storePixels(layer, output); this.rasterize(layer); }
    });
    this.recordAction?.({ type: 'basic-filter', name, mask: !!this.editMask });
  }
  clipSelection(context, layer, width, height) {
    if (!this.selection) return;
    const { x, y, width: w, height: h } = this.selection;
    const points = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
      .map((point) => localPoint(point, layer.transform, width, height));
    context.beginPath(); points.forEach((point, i) => i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath(); context.clip();
  }
  crop() {
    if (!this.selection) return;
    this.mutate('Crop Canvas', () => {
      const selection = this.selection;
      this.manifest.width = selection.width; this.manifest.height = selection.height;
      for (const layer of this.manifest.layers) {
        layer.transform.origin[0] -= selection.x; layer.transform.origin[1] -= selection.y;
        if (layer.maskPlacement) { layer.maskPlacement.origin[0] -= selection.x; layer.maskPlacement.origin[1] -= selection.y; }
      }
      for (const guide of this.manifest.guides ?? []) guide.position -= guide.axis === 'horizontal' ? selection.y : selection.x;
      this.selection = null;
    });
    this.fit();
  }
  addText(content) {
    if (!this.manifest || !content.trim()) return;
    this.mutate('Type', () => {
      const size = Math.min(72, Math.max(16, this.manifest.width / 16));
      const rgb = this.color.match(/[a-f\d]{2}/gi).map((component) => parseInt(component, 16) / 255);
      const style = { content, fontName: 'ArialMT', fontSize: size, red: rgb[0], green: rgb[1], blue: rgb[2], alignment: 'Left', tracking: 0, leading: 0 }, canvas = renderText(style);
      const layer = createLayer('Text', canvas.width, canvas.height);
      layer.transform.origin = [(this.manifest.width - canvas.width) / 2, (this.manifest.height - canvas.height) / 2];
      this.manifest.layers.push(layer); this.manifest.activeLayerID = layer.id;
      this.storePixels(layer, canvas);
      layer.text = style;
    });
  }
  viewPoint(event) { const rect = this.viewport.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top, pointerType: event.pointerType, pressure: event.pressure, tiltX: event.tiltX, tiltY: event.tiltY }; }
  toDocument(point) { return { ...point, x: (point.x - this.pan.x) / this.zoom, y: (point.y - this.pan.y) / this.zoom }; }
  fit() {
    if (!this.manifest) return;
    this.followsFit = true;
    this.zoom = Math.max(0.001, Math.min(32 / (window.devicePixelRatio || 1), (this.viewport.clientWidth - 96) / this.manifest.width, (this.viewport.clientHeight - 96) / this.manifest.height));
    this.pan = { x: (this.viewport.clientWidth - this.manifest.width * this.zoom) / 2, y: (this.viewport.clientHeight - this.manifest.height * this.zoom) / 2 };
    this.draw();
  }
  setZoom(value, anchor = { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 }) {
    this.followsFit = false;
    const point = this.toDocument(anchor); this.zoom = Math.max(0.001, Math.min(32 / (window.devicePixelRatio || 1), value));
    this.pan = { x: anchor.x - point.x * this.zoom, y: anchor.y - point.y * this.zoom };
    this.draw();
  }
  composite(full = false) {
    const scale = full ? 1 : Math.min(1, 4096 / Math.max(this.manifest.width, this.manifest.height), Math.sqrt(12000000 / (this.manifest.width * this.manifest.height)));
    const stroke = this.gesture && ['brush', 'retouch'].includes(this.gesture.kind) && !this.editMask ? this.gesture.layer?.id : null;
    const manifest = stroke ? { ...this.manifest, layers: this.manifest.layers.map((layer) => layer.id === stroke ? { ...layer, vectorPath: undefined } : layer) } : this.manifest;
    const render = (document, images, masks) => document.layers.some((layer) => layer.hdrSourceFile) ? composeHDRCanvas(document, images, masks, full ? 1 : Math.min(scale, 768 / Math.max(document.width, document.height))) : compose(document, images, masks, scale, this.assets);
    if (!this.rasterPreview) return render(manifest, this.images, this.masks);
    const edit = this.rasterPreview, images = new Map(this.images), masks = new Map(this.masks);
    (edit.isMask ? masks : images).set(edit.layerID, edit.image);
    if (edit.mask) masks.set(edit.layerID, edit.mask);
    const layers = manifest.layers.map((layer) => layer.id !== edit.layerID ? layer : edit.isMask ? { ...layer, maskPlacement: edit.transform } : { ...layer, transform: edit.transform, vectorPath: undefined });
    return render({ ...manifest, layers }, images, masks);
  }
  draw() {
    if (this.framePending) return;
    this.framePending = true;
    requestAnimationFrame(() => { this.framePending = false; this.render(); });
  }
  render() {
    const ratio = window.devicePixelRatio || 1, width = this.viewport.clientWidth, height = this.viewport.clientHeight;
    for (const canvas of [this.display, this.overlay]) {
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    }
    if (!this.manifest) return;
    const ctx = this.display.getContext('2d'), w = this.manifest.width * this.zoom, h = this.manifest.height * this.zoom;
    ctx.save(); ctx.translate(this.pan.x, this.pan.y);
    ctx.shadowColor = '#0009'; ctx.shadowBlur = 20; ctx.fillStyle = '#d5d8dc'; ctx.fillRect(0, 0, w, h); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.fillStyle = '#eef0f3';
    const left = Math.max(0, Math.floor(-this.pan.x / 12) * 12), top = Math.max(0, Math.floor(-this.pan.y / 12) * 12);
    const right = Math.min(w, width - this.pan.x), bottom = Math.min(h, height - this.pan.y);
    for (let y = top; y < bottom; y += 12) for (let x = left; x < right; x += 12) if ((Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0) ctx.fillRect(x, y, 12, 12);
    if (!this.preview) this.preview = this.composite();
    ctx.imageSmoothingEnabled = this.zoom < 4; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(this.preview, 0, 0, w, h);
    ctx.restore();
    const overlay = this.overlay.getContext('2d'); overlay.save(); overlay.translate(this.pan.x, this.pan.y); overlay.scale(this.zoom, this.zoom);
    overlay.lineWidth = 1 / this.zoom;
    for (const guide of this.manifest.guides ?? []) {
      overlay.strokeStyle = '#55cddd'; overlay.beginPath();
      if (guide.axis === 'horizontal') { overlay.moveTo(0, guide.position); overlay.lineTo(this.manifest.width, guide.position); }
      else { overlay.moveTo(guide.position, 0); overlay.lineTo(guide.position, this.manifest.height); } overlay.stroke();
    }
    const active = this.active;
    if (active && !active.isGroup && this.tool === 'move' && !this.floatingDraft) {
      const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((point) => documentPoint(point, active.transform));
      overlay.strokeStyle = '#78a9ff'; overlay.beginPath(); points.forEach((point, i) => i ? overlay.lineTo(point.x, point.y) : overlay.moveTo(point.x, point.y)); overlay.closePath(); overlay.stroke();
      overlay.fillStyle = '#dce9ff'; for (const point of points) overlay.fillRect(point.x - 3 / this.zoom, point.y - 3 / this.zoom, 6 / this.zoom, 6 / this.zoom);
    }
    const selection = this.gesture?.kind === 'marquee' || this.gesture?.kind === 'shape' ? this.gesture.rect : this.selection;
    if (selection && !this.floatingDraft) drawSelectionOutline(overlay, selection, this.zoom);
    overlay.restore();
    document.querySelector('#zoom-value').textContent = `${Math.round(this.zoom * (window.devicePixelRatio || 1) * 100)}%`;
  }
  pointerDown(event) {
    if (!this.manifest || this.busy || this.gesture || document.querySelector('dialog[open]') || event.button > 1) return;
    this.viewport.focus();
    const view = this.viewPoint(event), point = this.toDocument(view), layer = this.active;
    if (this.tool === 'hand' || this.spaceDown || event.button === 1) this.gesture = { kind: 'pan', view, pan: { ...this.pan } };
    else if (this.tool === 'move' && layer && !layer.isGroup) {
      this.gesture = { kind: 'move', point, origin: [...layer.transform.origin], before: this.snapshot() };
    } else if (['brush', 'eraser'].includes(this.tool) && layer && !layer.isGroup && !layer.adjustment) {
      const source = this.images.get(layer.id), before = this.snapshot();
      let width = source?.width ?? Math.ceil(layer.transform.size[0]), height = source?.height ?? Math.ceil(layer.transform.size[1]), transform;
      if (!source) {
        const pointOnGrid = localPoint(point, layer.transform, width, height), rx = this.brushSize / 2 * width / layer.transform.size[0] + 2, ry = this.brushSize / 2 * height / layer.transform.size[1] + 2;
        const left = Math.floor((pointOnGrid.x - rx) / 64) * 64, top = Math.floor((pointOnGrid.y - ry) / 64) * 64, right = Math.ceil((pointOnGrid.x + rx) / 64) * 64, bottom = Math.ceil((pointOnGrid.y + ry) / 64) * 64;
        transform = resizedGrid(layer.transform, width, height, left, top, right - left, bottom - top); width = right - left; height = bottom - top;
        if (documentPixels(this) + width * height > this.pixelBudget) { this.onError?.(new Error('The brush exceeds the document pixel budget.')); return; }
      }
      if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) return;
      const canvas = surface(width, height), paint = surface(width, height);
      if (transform) { if (layer.maskFile && !layer.maskPlacement) layer.maskPlacement = structuredClone(layer.transform); layer.transform = transform; }
      if (source) canvas.getContext('2d').drawImage(source, 0, 0);
      this.gesture = { kind: 'paint', before, layer, canvas, paint, source, previous: point, tool: this.tool, grown: !source, originalSource: source };
      this.paintSegment(point, point);
    } else if (['marquee', 'shape'].includes(this.tool)) this.gesture = { kind: this.tool, point, rect: null };
    else if (this.tool === 'eyedropper') {
      const canvas = this.composite(true);
      const x = Math.floor(point.x), y = Math.floor(point.y);
      if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) {
        const pixel = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
        this.color = '#' + [...pixel.slice(0, 3)].map((value) => value.toString(16).padStart(2, '0')).join(''); this.onChange();
      }
    }
    if (this.gesture) this.overlay.setPointerCapture(event.pointerId);
  }
  pointerMove(event) {
    const gesture = this.gesture;
    if (!gesture) return;
    const view = this.viewPoint(event), point = this.toDocument(view);
    if (gesture.kind === 'pan') {
      this.followsFit = false;
      this.pan = { x: gesture.pan.x + view.x - gesture.view.x, y: gesture.pan.y + view.y - gesture.view.y };
    } else if (gesture.kind === 'move') {
      this.active.transform.origin = [Math.round(gesture.origin[0] + point.x - gesture.point.x), Math.round(gesture.origin[1] + point.y - gesture.point.y)];
      const original = gesture.before.manifest.layers.find((layer) => layer.id === this.active.id);
      if (original?.maskPlacement && this.active.maskLinked !== false) this.active.maskPlacement = following(original.maskPlacement, original.transform, this.active.transform);
      this.preview = null;
    } else if (gesture.kind === 'paint') {
      this.paintSegment(gesture.previous, point); gesture.previous = point;
    } else if (gesture.kind === 'marquee' || gesture.kind === 'shape') {
      const x = Math.max(0, Math.min(this.manifest.width, Math.round(Math.min(point.x, gesture.point.x))));
      const y = Math.max(0, Math.min(this.manifest.height, Math.round(Math.min(point.y, gesture.point.y))));
      const maxX = Math.max(0, Math.min(this.manifest.width, Math.round(Math.max(point.x, gesture.point.x))));
      const maxY = Math.max(0, Math.min(this.manifest.height, Math.round(Math.max(point.y, gesture.point.y))));
      gesture.rect = { x, y, width: maxX - x, height: maxY - y };
    }
    this.draw();
  }
  paintSegment(from, to) {
    const gesture = this.gesture, { layer, canvas, paint } = gesture;
    const start = localPoint(from, layer.transform, canvas.width, canvas.height), end = localPoint(to, layer.transform, canvas.width, canvas.height);
    const tip = this.brushSize * canvas.width / layer.transform.size[0], ratio = (canvas.height / layer.transform.size[1]) / (canvas.width / layer.transform.size[0]);
    const distance = Math.hypot(end.x - start.x, end.y - start.y), steps = Math.max(1, Math.ceil(distance / Math.max(0.5, tip * 0.08)));
    const ctx = paint.getContext('2d'); ctx.save(); this.clipSelection(ctx, layer, canvas.width, canvas.height);
    for (let i = 0; i <= steps; i++) {
      const x = start.x + (end.x - start.x) * i / steps, y = start.y + (end.y - start.y) * i / steps;
      const response = penResponse({ ...to, pressure: (from.pressure ?? 1) + ((to.pressure ?? 1) - (from.pressure ?? 1)) * i / steps }, this.penSettings);
      ctx.save(); ctx.translate(x, y); ctx.rotate(response.angle); ctx.scale(response.size, ratio * response.size * response.aspect); ctx.globalAlpha = response.opacity;
      if (this.brushHardness >= 0.99) ctx.fillStyle = this.color;
      else {
        const gradient = ctx.createRadialGradient(0, 0, Math.max(0, tip / 2 * this.brushHardness), 0, 0, tip / 2);
        gradient.addColorStop(0, this.color); gradient.addColorStop(1, `${this.color}00`); ctx.fillStyle = gradient;
      }
      ctx.beginPath(); ctx.arc(0, 0, tip / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.restore();
    const target = canvas.getContext('2d'); target.clearRect(0, 0, canvas.width, canvas.height);
    if (gesture.source) target.drawImage(gesture.source, 0, 0);
    target.globalCompositeOperation = gesture.tool === 'eraser' ? 'destination-out' : 'source-over';
    target.globalAlpha = this.brushOpacity; target.drawImage(paint, 0, 0); target.globalAlpha = 1; target.globalCompositeOperation = 'source-over';
    canvas.compositorRevision = (canvas.compositorRevision ?? 0) + 1; this.images.set(layer.id, canvas); this.preview = null;
  }
  pointerUp(event) {
    const gesture = this.gesture;
    if (!gesture) return;
    this.pointerMove(event); this.gesture = null;
    try {
      if (gesture.kind === 'move') {
        const after = this.snapshot();
        if (JSON.stringify(gesture.before.manifest) !== JSON.stringify(after.manifest)) this.history.push(gesture.before, after, 'Move Layer');
      } else if (gesture.kind === 'paint') {
        this.storePixels(gesture.layer, this.prepareStroke?.(gesture) ?? gesture.canvas); this.rasterize(gesture.layer);
        this.history.push(gesture.before, this.snapshot(), gesture.tool === 'eraser' ? 'Erase' : 'Brush');
      } else if (gesture.kind === 'marquee') this.selection = gesture.rect?.width && gesture.rect?.height ? gesture.rect : null;
      else if (gesture.kind === 'shape' && gesture.rect?.width && gesture.rect?.height) {
        this.mutate('Shape', () => {
          const rect = gesture.rect, layer = createLayer(this.shapeKind, rect.width, rect.height), canvas = surface(rect.width, rect.height), ctx = canvas.getContext('2d');
          ctx.fillStyle = this.color;
          if (this.shapeKind === 'Ellipse') { ctx.beginPath(); ctx.ellipse(rect.width / 2, rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2); ctx.fill(); }
          else ctx.fillRect(0, 0, rect.width, rect.height);
          layer.transform.origin = [rect.x, rect.y];
          const rgb = this.color.match(/[a-f\d]{2}/gi).map((component) => parseInt(component, 16) / 255);
          layer.shape = { kind: this.shapeKind, red: rgb[0], green: rgb[1], blue: rgb[2], cornerRadius: 0 };
          this.manifest.layers.push(layer); this.manifest.activeLayerID = layer.id; this.storePixels(layer, canvas);
        });
      }
      this.update();
    } catch (error) { this.onError?.(error); }
    if (this.overlay.hasPointerCapture(event.pointerId)) this.overlay.releasePointerCapture(event.pointerId);
  }
  cancelGesture() {
    const gesture = this.gesture; this.gesture = null;
    if (!gesture) return;
    if (gesture.kind === 'paint') {
      if (gesture.source) this.images.set(gesture.layer.id, gesture.source); else this.images.delete(gesture.layer.id);
    }
    if (gesture.kind === 'move') this.active.transform.origin = gesture.origin;
    this.update();
  }
}
