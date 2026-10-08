export function installTouch(editor) {
  const canvas = editor.overlay, pointers = new Map(); let pinch = null, suppress = false;
  const center = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }; };
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    pointers.set(event.pointerId, editor.viewPoint(event));
    if (pointers.size >= 2) {
      editor.cancelGesture(); event.stopImmediatePropagation(); event.preventDefault(); suppress = true;
      const initial = center(); pinch = { ...initial, zoom: editor.zoom, point: editor.toDocument(initial) };
      canvas.setPointerCapture(event.pointerId);
    }
  }, true);
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch' || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, editor.viewPoint(event));
    if (!suppress) return; event.preventDefault(); event.stopImmediatePropagation();
    if (pointers.size < 2 || !pinch) return;
    const next = center(); editor.zoom = Math.max(.01, Math.min(32, pinch.zoom * next.distance / pinch.distance));
    editor.pan = { x: next.x - pinch.point.x * editor.zoom, y: next.y - pinch.point.y * editor.zoom }; editor.followsFit = false; editor.draw();
  }, true);
  const finish = (event) => {
    if (event.pointerType !== 'touch') return;
    pointers.delete(event.pointerId);
    if (suppress) { event.preventDefault(); event.stopImmediatePropagation(); if (!pointers.size) suppress = false; }
    if (pointers.size < 2) pinch = null;
  };
  canvas.addEventListener('pointerup', finish, true); canvas.addEventListener('pointercancel', finish, true);
}
