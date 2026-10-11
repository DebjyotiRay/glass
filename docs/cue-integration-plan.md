# Glass → Cue-v1 Integration (revised plan)

**Goal:** with `INTEGRATE_GLASS=1`, run Glass as ONE `BrowserWindow` (`cue-shell.html`, derived from `cue-v1.html`) hosting the `header`, `listen`, `ask`, `settings`, `shortcut-settings` views as `<webview>`s. With the flag unset, behaviour is unchanged.

## Key design decisions (changes vs. v1 of the plan)

1. **Virtual window proxies in `windowPool`.** Services do `windowPool.get('listen').webContents.send(...)`, and `windowManager`/`shortcutsService` call `isVisible/show/hide/setBounds/getBounds/setOpacity/setIgnoreMouseEvents/focus/isDestroyed/setContentProtection`. In integration mode `windowPool` holds `VirtualWindow` objects (one per view) wrapping the webview guest `webContents`. Visibility/size calls become IPC to the shell. Services need no changes. The real shell `BrowserWindow` is kept OUT of `windowPool` (exported via `getShellWindow()`).
2. **Dispatch inside `createWindows()`** (`if (process.env.INTEGRATE_GLASS) return createIntegratedWindow()`), because `createWindows()` is called from two places in `index.js` (startup and `activate`).
3. **Webview preload is forced in main** via `will-attach-webview` (`webPreferences.preload = src/preload.js`, `nodeIntegration=false`, `contextIsolation=true`, strip any page-supplied `preload`/`webpreferences`). The shell preload is sandboxed and does NOT `require('path')`; main supplies file URLs via `ipcMain.handle('shell:get-config')`.
4. **Guest registration:** after a webview's `dom-ready`, the shell sends `shell:webview-ready {name, webContentsId}`; main resolves `webContents.fromId` and binds it to that view's `VirtualWindow`.
5. **One broadcast helper** (`src/window/broadcast.js`, `broadcast(channel, ...args)`) iterating `webContents.getAllWebContents()` filtered to non-destroyed `window`/`webview` types (excludes devtools/backgroundPage). Replaces EVERY `BrowserWindow.getAllWindows().forEach(win => win.webContents.send(...))` (index.js, featureBridge.js, authService.js, settingsService.js), not just featureBridge. Works in both modes.
6. **Layout is CSS in the shell.** `layoutManager`/`movementManager` are not used in integration mode; `adjust-window-height`, `resize-header-window`, `move-header-to`, settings show/hide and header-state changes are routed to the shell or no-op'd.
7. **Content protection** applies to the single shell window.

## IPC contract (shell ⇄ main)

Views: `header | listen | ask | settings | shortcut-settings`. Shell DOM: container `#glass-<name>-container`, webview `#wv-<name>`.

| Channel | Dir | Payload |
|---|---|---|
| `shell:get-config` (invoke) | shell→main | returns `{ contentUrl, headerUrl }` — `file://` URLs without query (shell appends `?view=<name>` for content) |
| `shell:webview-ready` (send) | shell→main | `{ name, webContentsId }` |
| `shell:toggle-view` | main→shell | `{ name, visible }` |
| `shell:resize-view` | main→shell | `{ name, width?, height? }` (px) |

`window.shellApi` (shell preload): `getConfig()`, `notifyWebviewReady(name, id)`, `onToggleView(cb(payload))`, `onResizeView(cb(payload))`.

## Work breakdown

- **A. Main process** — `src/window/integratedWindow.js` (shell window, `VirtualWindow`, `will-attach-webview`, IPC handlers, `getShellWindow`), dispatch in `windowManager.createWindows`, integration branches in `windowManager` (visibility, resize header, adjustWindowHeight, header-state, content protection, settings show/hide), `shortcutsService` init, `windowBridge`.
- **B. Broadcast** — `src/window/broadcast.js` + replace all `getAllWindows` broadcast sites.
- **C. Shell renderer** — `src/ui/app/cue-shell.html` (copy of `cue-v1.html` + webview containers + CSS + init script) and `src/ui/app/cue-shell-preload.js`.

## Test

`INTEGRATE_GLASS=1 npm start` (integrated) / `npm start` (unchanged). Verify: header renders, listen toggles, STT/summary events reach the listen webview, ask streams, settings opens, model-state updates reach all views, content protection on shell.

## Risks

- Glass views assume transparent frameless windows; webview backdrop blur is unreliable → containers use opaque-ish backgrounds.
- `webviewTag` is discouraged by Electron; fallback is `WebContentsView` (VirtualWindow abstraction makes that swap local).
- Packaged builds: resolve paths with `__dirname`/`app.getAppPath()`, verify in a packaged `.app`.
