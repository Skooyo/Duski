import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Rect, RegionImage } from './actions/types';
import { TEMP_DIR } from './config';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function selectRegion(): Promise<RegionImage | null> {
  await sleep(100); // let the hidden pie leave the screen before the capture
  const displays = screen.getAllDisplays();
  const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)));
  const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)));
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
  const shots = displays.flatMap((d, i) => {
    const source = sources.find((s) => s.display_id === String(d.id)) ?? sources[i];
    return source ? [{ d, img: source.thumbnail }] : [];
  });
  if (!shots.length) throw new Error('Screen capture failed');
  const cursor = screen.getCursorScreenPoint();

  return new Promise((resolve) => {
    let finished = false;
    const wins = shots.map(({ d, img }) => {
      const w = new BrowserWindow({
        ...d.bounds,
        frame: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        enableLargerThanScreen: true,
        show: false,
        transparent: true, // before the screenshot paints, the real (identical) screen shows through: no flash
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
      });
      w.setAlwaysOnTop(true, 'screen-saver');
      w.webContents.once('did-finish-load', () => w.webContents.send('region:init', img.toDataURL()));
      // Show only after the renderer has painted the screenshot, so the screen never blinks.
      let shown = false;
      const reveal = () => {
        if (shown || w.isDestroyed()) return;
        shown = true;
        w.setBounds(d.bounds);
        w.show();
        if (screen.getDisplayNearestPoint(cursor).id === d.id) w.focus(); // Esc goes to this window
      };
      w.webContents.ipc.once('region:ready', reveal);
      setTimeout(reveal, 1500); // never leave the user without an overlay if the signal is lost
      w.on('closed', () => finish(null, -1)); // Alt+F4 counts as cancel
      void w.loadFile(path.join(__dirname, '..', 'static', 'region.html'));
      return w;
    });

    const onDone = (e: Electron.IpcMainEvent, rect: Rect | null) => finish(rect, wins.findIndex((w) => w.webContents === e.sender));
    ipcMain.on('region:done', onDone);

    function finish(rect: Rect | null, index: number): void {
      if (finished) return;
      finished = true;
      ipcMain.removeListener('region:done', onDone);
      wins.forEach((w) => w.isDestroyed() || w.destroy());
      if (!rect || index < 0 || rect.width < 5 || rect.height < 5) return resolve(null);

      // The thumbnail can differ from bounds * scaleFactor; scale by its real size.
      const { d, img } = shots[index];
      const size = img.getSize();
      const sx = size.width / d.bounds.width;
      const sy = size.height / d.bounds.height;
      try {
        const crop = img.crop({
          x: Math.round(rect.x * sx),
          y: Math.round(rect.y * sy),
          width: Math.round(rect.width * sx),
          height: Math.round(rect.height * sy),
        });
        fs.mkdirSync(TEMP_DIR, { recursive: true });
        const file = path.join(TEMP_DIR, `region-${Date.now()}.png`);
        fs.writeFileSync(file, crop.toPNG());
        resolve({ path: file, rect: { x: d.bounds.x + rect.x, y: d.bounds.y + rect.y, width: rect.width, height: rect.height } });
      } catch {
        resolve(null); // crop or disk error: treat as cancel, never leave the action hanging
      }
    }
  });
}
