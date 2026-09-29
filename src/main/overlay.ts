import { BrowserWindow } from 'electron';
import path from 'node:path';
import type { Rect } from './actions/types';

/** One translated block. `box` is [left, top, right, bottom] in pixels of the image Claude read. */
export interface OverlayBlock {
  box: [number, number, number, number];
  text: string;
}

/** The translated screen area: where it is on screen (DIP) and the PNG Claude read. */
export interface LensImage {
  rect: Rect;
  dataUrl: string;
  width: number;
  height: number;
}

export interface OverlayHandle {
  add(block: OverlayBlock): void;
  setVisible(on: boolean): void;
  close(): void;
}

/** Click-through window over a translated area that paints each translated block over its original text (like Google Lens). */
export function showOverlay(img: LensImage): OverlayHandle {
  const bounds = { x: Math.round(img.rect.x), y: Math.round(img.rect.y), width: Math.round(img.rect.width), height: Math.round(img.rect.height) };
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false, // focus stays with the translation popup
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  // Twice: on a monitor with other scaling, the first call uses the old scale factor (same as the pie).
  win.setBounds(bounds);
  win.setBounds(bounds);
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'pop-up-menu'); // below the popup, which uses 'screen-saver'

  const pending: OverlayBlock[] = [];
  let ready = false;
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('overlay:init', { image: img.dataUrl, width: img.width });
    for (const b of pending.splice(0)) win.webContents.send('overlay:block', b);
    ready = true;
    win.showInactive();
  });
  void win.loadFile(path.join(__dirname, '..', 'static', 'overlay.html'));

  return {
    add(block) {
      if (win.isDestroyed()) return;
      if (ready) win.webContents.send('overlay:block', block);
      else pending.push(block);
    },
    setVisible(on) {
      if (!win.isDestroyed()) win.webContents.send('overlay:visible', on);
    },
    close() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}
