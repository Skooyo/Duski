import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import path from 'node:path';
import type { PieAction, Point } from './actions/types';

const KEYS = ['Escape', '1', '2', '3', '4', '5', '6', '7', '8'];
let win: BrowserWindow;
let items: PieAction[] = [];
let cursor: Point = { x: 0, y: 0 };
let onPick: (action: PieAction, cursor: Point) => void = () => {};

/** Creates the hidden pie window once. It is reused for every hotkey press (instant open). */
export function initPie(actions: PieAction[], pick: (action: PieAction, cursor: Point) => void): void {
  items = actions.slice(0, 8);
  onPick = pick;
  win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    focusable: false, // the foreground app keeps focus and its text selection
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  void win.loadFile(path.join(__dirname, '..', 'static', 'pie.html'));
  ipcMain.on('pie:pick', (_e, id: string) => pickAt(items.findIndex((a) => a.id === id)));
  ipcMain.on('pie:close', () => hidePie());
}

export function togglePie(): void {
  if (win.isVisible()) hidePie();
  else showPie();
}

function showPie(): void {
  cursor = screen.getCursorScreenPoint();
  const { bounds } = screen.getDisplayNearestPoint(cursor);
  // Covers the display so a click outside the pie closes it. Twice: a move to a monitor
  // with other scaling uses the old scale factor on the first call.
  win.setBounds(bounds);
  win.setBounds(bounds);
  win.webContents.send('pie:show', {
    x: cursor.x - bounds.x,
    y: cursor.y - bounds.y,
    items: items.map(({ id, label, icon }) => ({ id, label, icon })),
  });
  win.showInactive();
  // The pie has no focus, so its keys must be global while it is open.
  KEYS.forEach((key, i) => globalShortcut.register(key, () => (i === 0 ? hidePie() : pickAt(i - 1))));
}

export function hidePie(): void {
  if (!win.isVisible()) return;
  KEYS.forEach((key) => globalShortcut.unregister(key));
  win.webContents.send('pie:clear');
  win.hide();
}

function pickAt(index: number): void {
  const action = items[index];
  if (!action) return;
  hidePie();
  onPick(action, cursor);
}
