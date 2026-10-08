export async function jpegPreview(canvas) {
  const dialog = document.createElement('dialog'); dialog.className = 'jpeg-dialog'; const heading = document.createElement('h2'); heading.textContent = 'Export JPEG';
  const preview = document.createElement('img'); preview.className = 'jpeg-preview'; preview.alt = 'JPEG export preview';
  const label = document.createElement('label'); label.className = 'setting-row'; const caption = document.createElement('span'); caption.textContent = 'Quality';
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = 1; slider.max = 100; slider.value = 92; slider.setAttribute('aria-label', 'JPEG quality');
  const number = document.createElement('output'), size = document.createElement('p'); size.className = 'dialog-description';
  let encoded; function update() { encoded = canvas.toDataURL('image/jpeg', Number(slider.value) / 100); preview.src = encoded; number.textContent = slider.value + '%'; size.textContent = `${canvas.width.toLocaleString()} × ${canvas.height.toLocaleString()} px · approximately ${Math.round(encoded.split(',')[1].length * .75 / 1024).toLocaleString()} KB`; }
  slider.addEventListener('input', update); label.append(caption, slider, number);
  const actions = document.createElement('div'); actions.className = 'dialog-actions'; for (const name of ['Cancel', 'Export']) { const button = document.createElement('button'); button.textContent = name; if (name === 'Export') button.className = 'primary'; button.addEventListener('click', () => dialog.close(name)); actions.append(button); }
  dialog.append(heading, preview, label, size, actions); document.body.append(dialog); update(); dialog.showModal();
  return await new Promise((resolve) => dialog.addEventListener('close', () => { const result = dialog.returnValue === 'Export' ? encoded : null; dialog.remove(); resolve(result); }, { once: true }));
}
