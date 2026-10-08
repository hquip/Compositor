const pending = new Map();
const listeners = new Set();
let sequence = 0;
let currentSession = null;
const webview = window.chrome?.webview;

if (webview) {
  webview.addEventListener('message', (event) => {
    const message = event.data;
    if (typeof message.command === 'string') for (const listener of listeners) listener(message.command, message);
    else if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const invoke = (channel, ...args) => new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve); webview.postMessage({ id, channel, args });
  });
  const send = (channel, ...args) => webview.postMessage({ channel, args });
  window.desktop = Object.freeze({
    openProject: () => invoke('project:open'),
    openRecent: (index) => invoke('project:recent', index),
    saveProject: (snapshot, saveAs, session = currentSession) => invoke('project:save', snapshot, saveAs, session),
    importImages: () => invoke('images:import'),
    dropFiles: webview.postMessageWithAdditionalObjects ? (files) => new Promise((resolve) => { const id = ++sequence; pending.set(id, resolve); webview.postMessageWithAdditionalObjects({ id, channel: 'files:drop', args: [] }, files); }) : null,
    exportImage: (data, format, resolution = 72) => invoke('image:export', data, format, resolution),
    exportFile: (data, format, name) => invoke('file:export', data, format, name),
    colorProfiles: () => invoke('color:profiles'),
    readColorProfile: (name) => invoke('color:profile', name),
    fontFamilies: () => invoke('fonts:list'),
    reloadProject: (id) => invoke('project:reload', id),
    copyImage: (data) => invoke('clipboard:write', data),
    pasteImage: () => invoke('clipboard:read'),
    limits: () => invoke('document:limits'),
    setLanguage: (language) => send('settings:language', language),
    setTheme: (theme) => send('settings:theme', theme),
    closeProject: (session) => send('project:close', session),
    setDocumentState: (state) => { if (state.sessionID) currentSession = state.sessionID; send('document:state', { ...state, sessionID: state.sessionID ?? currentSession }); },
    readyToClose: () => send('window:close'),
    onCommand: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
  });
}
