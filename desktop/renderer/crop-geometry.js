export function cropAspect(choice, width = 9, height = 20) {
  if (choice === 'Free') return null;
  const values = choice === 'Custom' ? [Number(width), Number(height)] : choice.split(':').map(Number);
  if (values.length !== 2 || !values.every((value) => Number.isFinite(value) && value >= 1 && value <= 10000)) throw new Error('Enter a crop ratio from 1 to 10,000 on each side.');
  return values[0] / values[1];
}

export function constrainedCrop(start, end, width, height, ratio) {
  const a = { x: Math.max(0, Math.min(width - 1, start.x)), y: Math.max(0, Math.min(height - 1, start.y)) };
  const b = { x: Math.max(0, Math.min(width, end.x)), y: Math.max(0, Math.min(height, end.y)) };
  const dx = b.x < a.x ? -1 : 1, dy = b.y < a.y ? -1 : 1;
  let w = Math.max(1, Math.abs(b.x - a.x)), h = Math.max(1, Math.abs(b.y - a.y));
  if (ratio) {
    if (w / h > ratio) h = w / ratio; else w = h * ratio;
    const factor = Math.min(1, (dx < 0 ? a.x : width - a.x) / w, (dy < 0 ? a.y : height - a.y) / h);
    w *= factor; h *= factor;
  }
  return { x: dx < 0 ? a.x - w : a.x, y: dy < 0 ? a.y - h : a.y, width: w, height: h };
}
