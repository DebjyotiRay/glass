const { webContents } = require('electron');

function broadcast(channel, ...args) {
    for (const wc of webContents.getAllWebContents()) {
        try {
            if (wc.isDestroyed()) continue;
            const type = wc.getType();
            if (type !== 'window' && type !== 'webview') continue;
            wc.send(channel, ...args);
        } catch (e) {
            console.warn(`[broadcast] Failed to send ${channel}:`, e.message);
        }
    }
}

module.exports = { broadcast };
