const paths = {
  path: '<path d="M4 18C4 5 20 19 20 6M4 18l4-4M20 6l-4 4"/><rect x="2" y="16" width="4" height="4"/><rect x="18" y="4" width="4" height="4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 3"/>',
  lasso: '<path d="M7 17c-4-1-5-5-3-8 2-4 9-6 14-3 4 3 3 8-2 10-4 2-10 2-10-1 0-2 3-3 4-1 2 3-1 6-4 7"/>',
  polygon: '<path d="m4 5 13-2 4 12-10 6-8-7 1-9Z" stroke-dasharray="3 2"/><circle cx="4" cy="5" r="2"/>',
  wand: '<path d="m3 21 13-13 3 3L6 24M14 4V1M20 5l2-2M21 11h3M9 6 7 4" transform="translate(0 -2)"/>',
  object: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><path d="m9 7 9 6-5 1-2 5-2-12Z"/>',
  clone: '<path d="M5 16h14v5H5v-5Zm3-2c0-2 2-3 2-5V7a3 3 0 1 1 4 0v2c0 2 2 3 2 5M3 21h18"/>',
  heal: '<path d="m5 11 6-6a5 5 0 0 1 7 7l-6 6a5 5 0 0 1-7-7Z"/><path d="m8 8 8 8M10 12h.1M12 10h.1M12 14h.1M14 12h.1"/>',
  blur: '<path d="M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z"/><path d="M9 15c0 2 1 3 3 3"/>',
  gradient: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 5v14" stroke-width="4" opacity=".2"/><path d="M11 5v14" stroke-width="4" opacity=".45"/><path d="M15 5v14" stroke-width="4" opacity=".7"/><path d="M19 5v14" stroke-width="3"/>',
  crop: '<path d="M7 2v15h15M2 7h15v15M10 3h11v11"/>',
  move: '<path d="m5 3 14 10-7 1-3 7-4-18Z"/>',
  brush: '<path d="m14 5 4 4M10 13l9-10 3 3-10 9M10 13c-5-3-7 3-7 7 4 0 10-2 7-7Z"/>',
  eraser: '<path d="m4 13 9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8H8l-4-4a2 2 0 0 1 0-3Zm4-4 9 9M13 20h9"/>',
  marquee: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>',
  shape: '<rect x="4" y="4" width="13" height="13" rx="1.5"/><path d="M10 20h9a1 1 0 0 0 1-1v-9"/>',
  text: '<path d="M4 7V4h16v3M12 4v16M8 20h8"/>',
  eyedropper: '<path d="m14 5 5 5M16 3l5 5M6 14l9-9 4 4-9 9-5 1 1-5ZM5 19l-2 2"/>',
  hand: '<path d="M8 13V5a2 2 0 0 1 4 0v7-8a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-5-1-7-4l-3-4a2 2 0 0 1 3-2l2 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  open: '<path d="M3 8V5a1 1 0 0 1 1-1h6l2 3h7a2 2 0 0 1 2 2v2M3 9h18l-3 11H4L2 9h1Z"/>',
  import: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  save: '<path d="M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8"/>',
  export: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  undo: '<path d="M8 5 3 10l5 5M3 10h10a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  redo: '<path d="m16 5 5 5-5 5m5-5H11a6 6 0 0 0 0 12" transform="translate(0 -2)"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',
  up: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  down: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  rename: '<path d="m14 5 5 5M4 20l5-1L21 7l-4-4L5 15l-1 5ZM13 20h8"/>',
  flipX: '<path d="M12 3v18M8 6 3 18h5V6Zm8 0 5 12h-5V6Z"/>',
  flipY: '<path d="M3 12h18M6 8l12-5v5H6Zm0 8 12 5v-5H6Z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18M10 5c7-2 12 7 12 7s-1 2-4 4M6 6C3 8 2 12 2 12s4 7 10 7c2 0 3-1 4-1M10 10a3 3 0 0 0 4 4"/>',
  folder: '<path d="M3 6h7l2 3h9v11H3V6Z"/>',
  layer: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 10 9 5 9-5M3 18l9 5 9-5" transform="translate(0 -1)"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 8"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
};

export function icon(name, size = 18) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  element.setAttribute('viewBox', '0 0 24 24'); element.setAttribute('width', size); element.setAttribute('height', size);
  element.setAttribute('fill', 'none'); element.setAttribute('stroke', 'currentColor'); element.setAttribute('stroke-width', '1.6');
  element.setAttribute('stroke-linecap', 'round'); element.setAttribute('stroke-linejoin', 'round'); element.setAttribute('aria-hidden', 'true');
  element.innerHTML = paths[name] ?? paths.image;
  return element;
}

export function installIcons() {
  document.querySelectorAll('[data-icon]').forEach((element) => element.replaceChildren(icon(element.dataset.icon)));
}
