export function affine(transform) {
  const angle = transform.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), [w, h] = transform.size;
  const a = cos * w * (transform.flipX ? -1 : 1), b = sin * w * (transform.flipX ? -1 : 1), c = -sin * h * (transform.flipY ? -1 : 1), d = cos * h * (transform.flipY ? -1 : 1);
  return [a, b, c, d, transform.origin[0] + w / 2 - (a + c) / 2, transform.origin[1] + h / 2 - (b + d) / 2];
}
export function multiply(a, b) { return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; }
export function inverse(a) { const determinant = a[0] * a[3] - a[1] * a[2]; return [a[3] / determinant, -a[1] / determinant, -a[2] / determinant, a[0] / determinant, (a[2] * a[5] - a[3] * a[4]) / determinant, (a[1] * a[4] - a[0] * a[5]) / determinant]; }
export function following(placement, before, after) {
  const m = multiply(multiply(affine(after), inverse(affine(before))), affine(placement)), sign = placement.flipX ? -1 : 1;
  const angle = Math.atan2(m[1] * sign, m[0] * sign), along = -m[2] * Math.sin(angle) + m[3] * Math.cos(angle), width = Math.hypot(m[0], m[1]), height = Math.abs(along);
  return { ...placement, origin: [m[4] + (m[0] + m[2]) / 2 - width / 2, m[5] + (m[1] + m[3]) / 2 - height / 2], size: [width, height], rotation: angle * 180 / Math.PI, flipY: along < 0 };
}
export function followLinkedMasks(document, before) {
  const originals = new Map(before.layers.map((layer) => [layer.id, layer]));
  for (const layer of document.layers) {
    const old = originals.get(layer.id);
    if (old?.maskPlacement && layer.maskPlacement && layer.maskLinked !== false && JSON.stringify(old.maskPlacement) === JSON.stringify(layer.maskPlacement) && JSON.stringify(old.transform) !== JSON.stringify(layer.transform)) layer.maskPlacement = following(layer.maskPlacement, old.transform, layer.transform);
  }
}
