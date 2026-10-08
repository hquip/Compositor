const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export function segment(contour, index) {
  const a = contour.nodes[index], b = contour.nodes[(index + 1) % contour.nodes.length];
  return [a.point, a.outgoing ?? a.point, b.incoming ?? b.point, b.point];
}
export function curvePoint(points, t) {
  const [a, b, c, d] = points, ab = lerp(a, b, t), bc = lerp(b, c, t), cd = lerp(c, d, t);
  return lerp(lerp(ab, bc, t), lerp(bc, cd, t), t);
}
export function splitSegment(contour, index, t = .5) {
  if (!(t > 0 && t < 1) || index < 0 || index >= contour.nodes.length - (contour.closed ? 0 : 1)) throw new Error('Invalid path segment.');
  const [a, b, c, d] = segment(contour, index), ab = lerp(a, b, t), bc = lerp(b, c, t), cd = lerp(c, d, t), abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t);
  contour.nodes[index].outgoing = ab; contour.nodes[(index + 1) % contour.nodes.length].incoming = cd;
  contour.nodes.splice(index + 1, 0, { point: lerp(abc, bcd, t), incoming: abc, outgoing: bcd });
  return index + 1;
}
export function nearestSegment(contours, point) {
  let best = null;
  contours.forEach((contour, c) => {
    for (let i = 0; i < contour.nodes.length - (contour.closed ? 0 : 1); i++) {
      const points = segment(contour, i);
      for (let step = 1; step < 64; step++) {
        const t = step / 64, p = curvePoint(points, t), distance = Math.hypot(p[0] - point[0], p[1] - point[1]);
        if (!best || distance < best.distance) best = { contour: c, index: i, t, distance };
      }
    }
  }); return best;
}
export function mapContours(contours, map) {
  return contours.map((contour) => ({ closed: contour.closed, nodes: contour.nodes.map((node) => Object.fromEntries(Object.entries(node).map(([key, point]) => [key, map(point)]))) }));
}
export function traceContours(context, contours, map = (p) => p) {
  context.beginPath();
  for (const contour of contours) {
    if (!contour.nodes.length) continue;
    context.moveTo(...map(contour.nodes[0].point));
    for (let i = 0; i < contour.nodes.length - (contour.closed ? 0 : 1); i++) {
      const [, b, c, d] = segment(contour, i); context.bezierCurveTo(...map(b), ...map(c), ...map(d));
    }
    if (contour.closed) context.closePath();
  }
}
export function pathBounds(contours, padding = 0) {
  const points = contours.flatMap((c) => c.nodes.flatMap((n) => Object.values(n)));
  if (!points.length) throw new Error('Add at least two path points.');
  // The control-point hull contains every curve, including extrema between its anchors.
  const x = Math.floor(Math.min(...points.map((p) => p[0])) - padding), y = Math.floor(Math.min(...points.map((p) => p[1])) - padding);
  return { x, y, width: Math.max(1, Math.ceil(Math.max(...points.map((p) => p[0])) + padding) - x), height: Math.max(1, Math.ceil(Math.max(...points.map((p) => p[1])) + padding) - y) };
}
