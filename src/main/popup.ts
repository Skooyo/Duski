import { BrowserWindow, clipboard, ipcMain, screen } from 'electron';
import path from 'node:path';
import type { Point } from './actions/types';

export type PopupStatus = 'loading' | 'streaming' | 'done' | 'error';

export interface PopupHandle {
  update(status: PopupStatus, text: string): void;
  /** Resolves when the popup window closes (user or replacement). */
  closed: Promise<void>;
}

const WIDTH = 480;
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 400;
let current: BrowserWindow | null = null;

export function initPopupIpc(): void {
  ipcMain.on('popup:close', (e) => BrowserWindow.fromWebContents(e.sender)?.destroy());
  ipcMain.on('popup:copy', (_e, text: string) => clipboard.writeText(text));
  ipcMain.on('popup:resize', (e, height: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const h = clamp(Math.ceil(height), MIN_HEIGHT, MAX_HEIGHT);
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const [x, y] = win.getPosition();
    win.setBounds({ x, y: Math.min(y, wa.y + wa.height - h), width: WIDTH, height: h });
  });
}

/** Opens the translation popup near `anchor`. Only one popup exists; a new one replaces the old one. */
export function showPopup(anchor: Point): PopupHandle {
  current?.destroy();
  const wa = screen.getDisplayNearestPoint(anchor).workArea;
  const height = 120;
  const win = new BrowserWindow({
    x: clamp(Math.round(anchor.x) + 12, wa.x, wa.x + wa.width - WIDTH),
    y: clamp(Math.round(anchor.y) + 12, wa.y, wa.y + wa.height - height),
    width: WIDTH,
    height,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  current = win;

  let state: { status: PopupStatus; text: string } = { status: 'loading', text: '' };
  let ready = false;
  win.webContents.once('did-finish-load', () => {
    ready = true;
    win.webContents.send('popup:update', state);
    win.show();
  });
  void win.loadFile(path.join(__dirname, '..', 'static', 'popup.html'));

  const closed = new Promise<void>((resolve) =>
    win.on('closed', () => {
      if (current === win) current = null;
      resolve();
    }),
  );

  return {
    update(status, text) {
      state = { status, text };
      if (ready && !win.isDestroyed()) win.webContents.send('popup:update', state);
    },
    closed,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
