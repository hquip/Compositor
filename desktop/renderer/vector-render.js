import { surface, colorCSS } from './raster.js';
import { traceContours } from './vector-geometry.js';
export function renderVector(style, width, height, mask = false) {
  const canvas = surface(width, height), ctx = canvas.getContext('2d');
  traceContours(ctx, style.contours, (p) => [p[0] * canvas.width, p[1] * canvas.height]);
  if (mask || style.fill) { ctx.fillStyle = mask ? '#fff' : colorCSS(style.fill); ctx.fill(style.fillRule); }
  if (!mask && style.stroke && style.strokeWidth > 0) {
    ctx.strokeStyle = colorCSS(style.stroke); ctx.lineWidth = style.strokeWidth * Math.min(canvas.width, canvas.height); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  }
  return canvas;
}
