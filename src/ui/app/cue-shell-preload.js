// Sandbox-safe preload for the integrated Cue shell window.
// Only contextBridge + ipcRenderer are used (no path/fs).
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('shellApi', {
    getConfig: () => ipcRenderer.invoke('shell:get-config'),
    notifyWebviewReady: (name, id) => ipcRenderer.send('shell:webview-ready', { name, webContentsId: id }),
    onToggleView: cb => subscribe('shell:toggle-view', cb),
    onResizeView: cb => subscribe('shell:resize-view', cb),
});
