import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { getConfig, saveBounds } from './config';
import { appIcon } from './tray';

/** A normal app window that opens where it was last closed (bounds live in config.json). Shows and focuses itself when ready. */
export function savedWindow(key: 'chatWindow' | 'todoWindow', title: string): BrowserWindow {
  const b = getConfig()[key];
  const pos = b.x !== null && b.y !== null && onScreen(b.x, b.y) ? { x: b.x, y: b.y } : {};
  const w = new BrowserWindow({
    ...pos,
    width: b.width,
    height: b.height,
    minWidth: 320,
    minHeight: 320,
    title,
    icon: appIcon(), // taskbar icon
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  w.once('ready-to-show', () => {
    w.show();
    w.focus();
  });
  w.on('close', () => {
    const r = w.getNormalBounds(); // not getBounds(): minimized is -32000,-32000 and maximized is full screen
    try {
      saveBounds(key, { x: r.x, y: r.y, width: r.width, height: r.height });
    } catch {
      // config.json not writable; losing the window position is harmless
    }
  });
  return w;
}

function onScreen(x: number, y: number): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height);
}
