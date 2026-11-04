import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';

/** The diagram viewer: one window, 80% of the screen, always on top. A new diagram replaces the old one. */

let win: BrowserWindow | null = null;
let svg = '';

export function initViewerIpc(): void {
  ipcMain.on('viewer:open', (e, next: unknown) => {
    if (typeof next !== 'string' || !next) return;
    svg = next;
    if (win) {
      win.webContents.send('viewer:show', svg);
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    const from = BrowserWindow.fromWebContents(e.sender);
    const wa = (from ? screen.getDisplayMatching(from.getBounds()) : screen.getPrimaryDisplay()).workArea;
    const width = Math.round(wa.width * 0.8);
    const height = Math.round(wa.height * 0.8);
    const w = new BrowserWindow({
      x: wa.x + Math.round((wa.width - width) / 2),
      y: wa.y + Math.round((wa.height - height) / 2),
      width,
      height,
      frame: false,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    w.setAlwaysOnTop(true, 'floating');
    win = w;
    w.once('ready-to-show', () => {
      w.show();
      w.focus();
    });
    w.on('closed', () => win === w && (win = null));
    void w.loadFile(path.join(__dirname, '..', 'static', 'viewer.html'));
  });
  ipcMain.on('viewer:ready', (e) => e.sender.send('viewer:show', svg));
  ipcMain.on('viewer:minimize', () => win?.minimize()); // the taskbar button or a click on a diagram brings it back
  ipcMain.on('viewer:close', () => win?.destroy());
}
