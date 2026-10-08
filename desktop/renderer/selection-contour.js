const contours = new WeakMap();
export function selectionPath(selection) {
  if (!selection.coverage) {
    const path = new Path2D();
    if (selection.points?.length) { selection.points.forEach((point, index) => index ? path.lineTo(point.x, point.y) : path.moveTo(point.x, point.y)); path.closePath(); }
    else if (selection.kind === 'ellipse') path.ellipse(selection.x + selection.width / 2, selection.y + selection.height / 2, selection.width / 2, selection.height / 2, 0, 0, Math.PI * 2);
    else path.rect(selection.x, selection.y, selection.width, selection.height);
    return path;
  }
  const canvas = selection.coverage;
  if (contours.has(canvas)) return contours.get(canvas);
  const { width, height } = canvas, pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data, path = new Path2D();
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && pixels[(y * width + x) * 4 + 3] >= 128;
  // Merge adjacent exposed cell edges. Internal holes stay part of the outline.
  for (let y = 0; y <= height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const edge = x < width && inside(x, y - 1) !== inside(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) { path.moveTo(start, y); path.lineTo(x, y); start = -1; }
    }
  }
  for (let x = 0; x <= width; x++) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      const edge = y < height && inside(x - 1, y) !== inside(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) { path.moveTo(x, start); path.lineTo(x, y); start = -1; }
    }
  }
  contours.set(canvas, path); return path;
}
export function drawSelectionOutline(context, selection, zoom) {
  context.save(); if (selection.coverage) context.translate(selection.offsetX ?? 0, selection.offsetY ?? 0);
  const path = selectionPath(selection); context.lineWidth = 1 / zoom; context.setLineDash([5 / zoom, 5 / zoom]); context.strokeStyle = '#111'; context.stroke(path);
  context.lineDashOffset = 5 / zoom; context.strokeStyle = '#fff'; context.stroke(path); context.restore();
}
