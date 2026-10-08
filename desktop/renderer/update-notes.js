export async function latestRelease(fetcher = fetch) {
  const response = await fetcher('https://api.github.com/repos/hquip/Compositor/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Could not retrieve the latest release notes.');
  const release = await response.json();
  if (!release || typeof release.tag_name !== 'string' || release.tag_name.length > 100 || typeof release.html_url !== 'string' || !release.html_url.startsWith('https://github.com/hquip/Compositor/releases/')) throw new Error('Invalid release information.');
  return { version: release.tag_name, notes: typeof release.body === 'string' ? release.body.slice(0, 200000) : '', url: release.html_url };
}
export function installUpdateNotes(editor, api) {
  const previous = editor.advancedCommand;
  editor.advancedCommand = async (command) => {
    if (command !== 'check-updates') return previous(command);
    const release = await latestRelease(), dialog = document.createElement('dialog'), title = document.createElement('h2'), notes = document.createElement('pre'), actions = document.createElement('div');
    title.textContent = 'Release ' + release.version; notes.textContent = release.notes || 'No release notes were provided.'; notes.className = 'release-notes'; actions.className = 'dialog-actions';
    const link = document.createElement('a'); link.textContent = 'View release and downloads'; link.href = release.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const close = document.createElement('button'); close.textContent = 'Close'; close.addEventListener('click', () => dialog.close()); actions.append(link, close); dialog.append(title, notes, actions); document.body.append(dialog); dialog.showModal();
    await new Promise((resolve) => dialog.addEventListener('close', () => { dialog.remove(); resolve(); }, { once: true })); return true;
  };
}
