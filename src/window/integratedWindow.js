/**
 * Integrated (single-window) mode, enabled with INTEGRATE_GLASS=1.
 *
 * One shell BrowserWindow (cue-shell.html) hosts every Glass view as a <webview>.
 * windowPool is filled with VirtualWindow objects that look like the subset of the
 * BrowserWindow API the rest of the app uses, so services need no changes.
 */
const { BrowserWindow, ipcMain, webContents, app } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const VIEW_NAMES = ['header', 'listen', 'ask', 'settings', 'shortcut-settings'];

const DEFAULT_SIZES = {
    header: { width: 353, height: 47 },
    listen: { width: 400, height: 300 },
    ask: { width: 600, height: 300 },
    settings: { width: 240, height: 300 },
    'shortcut-settings': { width: 353, height: 720 },
};

let shellWindow = null;
let ipcRegistered = false;
const virtualWindows = new Map();

const noop = () => {};

/** Stand-in used until the guest webContents is bound. send() queues. */
function createStubWebContents(queue) {
    const base = {
        send: (channel, ...args) => queue.push([channel, args]),
        isDestroyed: () => false,
        executeJavaScript: () => Promise.resolve(undefined),
        loadURL: () => Promise.resolve(),
        isLoading: () => false,
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop === 'symbol' || prop === 'then') return undefined;
            return noop;
        },
    });
}

class VirtualWindow extends EventEmitter {
    constructor(name, getShell) {
        super();
        this.name = name;
        this._getShell = getShell;
        this._visible = name === 'header';
        this._destroyed = false;
        this._size = { ...DEFAULT_SIZES[name] };
        this._opacity = 1;
        this._resizable = false;
        this._alwaysOnTop = false;
        this._contentProtection = false;
        this._ignoreMouse = false;
        this._queue = [];
        this._stub = createStubWebContents(this._queue);
        this._wc = null;
    }

    // ── webContents binding ────────────────────────────────
    get webContents() {
        return this._wc && !this._wc.isDestroyed() ? this._wc : this._stub;
    }

    bind(wc) {
        this._wc = wc;
        wc.once('destroyed', () => {
            if (this._wc === wc) this._wc = null;
        });
        const pending = this._queue.splice(0);
        for (const [channel, args] of pending) {
            try { wc.send(channel, ...args); } catch (e) { /* ignore */ }
        }
        this._sendToShell('shell:toggle-view', { name: this.name, visible: this._visible });
        this.emit('webcontents-bound', wc);
    }

    _sendToShell(channel, payload) {
        const shell = this._getShell();
        if (shell && !shell.isDestroyed() && !shell.webContents.isDestroyed()) {
            shell.webContents.send(channel, payload);
        }
    }

    // ── lifecycle / visibility ─────────────────────────────
    isDestroyed() { return this._destroyed; }
    destroy() { this._destroyed = true; this.emit('closed'); }
    close() { this.hide(); }

    isVisible() { return this._visible; }
    show() {
        this._visible = true;
        this._sendToShell('shell:toggle-view', { name: this.name, visible: true });
        this.emit('show');
    }
    showInactive() { this.show(); }
    hide() {
        this._visible = false;
        this._sendToShell('shell:toggle-view', { name: this.name, visible: false });
        this.emit('hide');
    }
    focus() {
        const shell = this._getShell();
        if (shell && !shell.isDestroyed()) shell.focus();
        const wc = this._wc;
        if (wc && !wc.isDestroyed()) wc.focus();
        this.emit('focus');
    }
    blur() {}
    isFocused() {
        const shell = this._getShell();
        return !!(shell && !shell.isDestroyed() && shell.isFocused());
    }
    isMinimized() {
        const shell = this._getShell();
        return !!(shell && !shell.isDestroyed() && shell.isMinimized());
    }
    restore() {
        const shell = this._getShell();
        if (shell && !shell.isDestroyed()) shell.restore();
    }
    moveTop() {}

    // ── geometry ───────────────────────────────────────────
    getBounds() {
        const shell = this._getShell();
        const sb = shell && !shell.isDestroyed() ? shell.getBounds() : { x: 0, y: 0 };
        return { x: sb.x, y: sb.y, width: this._size.width, height: this._size.height };
    }
    getSize() { return [this._size.width, this._size.height]; }
    getContentBounds() { return this.getBounds(); }
    getPosition() { const b = this.getBounds(); return [b.x, b.y]; }

    setBounds(bounds = {}) { this._applySize(bounds.width, bounds.height); }
    setSize(width, height) { this._applySize(width, height); }
    setContentSize(width, height) { this._applySize(width, height); }
    setPosition() { /* layout is CSS in the shell */ }

    _applySize(width, height) {
        const payload = { name: this.name };
        if (Number.isFinite(width)) { this._size.width = Math.round(width); payload.width = this._size.width; }
        if (Number.isFinite(height)) { this._size.height = Math.round(height); payload.height = this._size.height; }
        if (payload.width === undefined && payload.height === undefined) return;
        this._sendToShell('shell:resize-view', payload);
        this.emit('resize');
    }

    // ── misc state ─────────────────────────────────────────
    setOpacity(value) { this._opacity = value; }
    getOpacity() { return this._opacity; }
    setIgnoreMouseEvents(ignore) { this._ignoreMouse = !!ignore; }
    setContentProtection(flag) {
        this._contentProtection = !!flag;
        const shell = this._getShell();
        if (shell && !shell.isDestroyed()) shell.setContentProtection(!!flag);
    }
    isResizable() { return this._resizable; }
    setResizable(flag) { this._resizable = !!flag; }
    setAlwaysOnTop(flag) { this._alwaysOnTop = !!flag; }
    isAlwaysOnTop() { return this._alwaysOnTop; }
    setVisibleOnAllWorkspaces() {}
    setWindowButtonVisibility() {}
    setMinimumSize() {}
    setMaximumSize() {}
    getNativeWindowHandle() {
        const shell = this._getShell();
        return shell && !shell.isDestroyed() ? shell.getNativeWindowHandle() : Buffer.alloc(0);
    }
}

function getShellWindow() {
    return shellWindow && !shellWindow.isDestroyed() ? shellWindow : null;
}

function isIntegrated() {
    return !!process.env.INTEGRATE_GLASS;
}

function registerIpc() {
    if (ipcRegistered) return;
    ipcRegistered = true;

    ipcMain.removeHandler('shell:get-config');
    ipcMain.handle('shell:get-config', () => ({
        contentUrl: pathToFileURL(path.join(__dirname, '../ui/app/content.html')).toString(),
        headerUrl: pathToFileURL(path.join(__dirname, '../ui/app/header.html')).toString(),
    }));

    ipcMain.on('shell:webview-ready', (event, payload) => {
        if (!shellWindow || shellWindow.isDestroyed() || event.sender !== shellWindow.webContents) return;
        const { name, webContentsId } = payload || {};
        const vw = virtualWindows.get(name);
        if (!vw) {
            console.warn(`[IntegratedWindow] webview-ready for unknown view '${name}'`);
            return;
        }
        const wc = webContents.fromId(webContentsId);
        if (!wc || wc.isDestroyed()) {
            console.warn(`[IntegratedWindow] webContents ${webContentsId} for '${name}' not found`);
            return;
        }
        vw.bind(wc);
        if (!app.isPackaged && process.env.GLASS_DEVTOOLS) {
            try { wc.openDevTools({ mode: 'detach' }); } catch (e) { /* ignore */ }
        }
    });
}

function createIntegratedWindow(windowPool) {
    if (shellWindow && !shellWindow.isDestroyed()) {
        shellWindow.show();
        return windowPool;
    }

    registerIpc();

    shellWindow = new BrowserWindow({
        width: 1100,
        height: 760,
        frame: true,
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        backgroundColor: '#00000000',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            preload: path.join(__dirname, '../ui/app/cue-shell-preload.js'),
        },
    });

    // Apply content protection state (lazy require: windowManager requires us).
    try {
        const { getContentProtectionStatus } = require('./windowManager');
        shellWindow.setContentProtection(getContentProtectionStatus());
    } catch (e) {
        shellWindow.setContentProtection(true);
    }

    shellWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        const src = params.src || '';
        if (src && !src.startsWith('file:')) {
            console.warn('[IntegratedWindow] Blocked webview with non-file src:', src);
            event.preventDefault();
            return;
        }
        delete params.preload;
        delete params.preloadURL;
        delete webPreferences.preloadURL;
        webPreferences.preload = path.join(__dirname, '../preload.js');
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
    });

    shellWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    virtualWindows.clear();
    for (const name of VIEW_NAMES) {
        const vw = new VirtualWindow(name, getShellWindow);
        virtualWindows.set(name, vw);
        windowPool.set(name, vw);
    }

    // Re-sync visibility once the shell has loaded (covers show/hide issued earlier).
    shellWindow.webContents.on('did-finish-load', () => {
        for (const vw of virtualWindows.values()) {
            vw._sendToShell('shell:toggle-view', { name: vw.name, visible: vw._visible });
        }
    });

    shellWindow.on('closed', () => {
        shellWindow = null;
        for (const [name, vw] of virtualWindows) {
            vw.destroy();
            if (windowPool.get(name) === vw) windowPool.delete(name);
        }
        virtualWindows.clear();
    });

    shellWindow.loadFile(path.join(__dirname, '../ui/app/cue-shell.html'));

    if (!app.isPackaged && process.env.GLASS_SHELL_DEVTOOLS) {
        shellWindow.webContents.openDevTools({ mode: 'detach' });
    }

    return windowPool;
}

module.exports = { createIntegratedWindow, getShellWindow, isIntegrated, VirtualWindow };
