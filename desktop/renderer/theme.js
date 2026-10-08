export function resolveTheme(choice, dark) {
  return choice === 'Light' ? 'light' : choice === 'Dark' ? 'dark' : dark ? 'dark' : 'light';
}

export function installTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)'), select = document.createElement('select');
  select.id = 'theme'; select.setAttribute('aria-label', 'Appearance');
  for (const name of ['System', 'Light', 'Dark']) { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option); }
  let saved = localStorage.getItem('compositor.theme') ?? 'Dark';
  const apply = () => {
    const choice = ['System', 'Light', 'Dark'].includes(saved) ? saved : 'Dark', theme = resolveTheme(choice, media.matches);
    select.value = choice; document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme;
    window.desktop?.setTheme?.(theme); window.dispatchEvent(new CustomEvent('themechange', { detail: { choice, theme } }));
  };
  select.addEventListener('change', () => { saved = select.value; localStorage.setItem('compositor.theme', saved); apply(); });
  media.addEventListener('change', apply); document.querySelector('#language').before(select); apply();
}
