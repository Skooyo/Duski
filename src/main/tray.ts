import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { AGENT_HOME } from './config';

let tray: Tray | null = null; // module-level so it is not garbage-collected

/** 16x16 blue dot, drawn in code so the app needs no icon file. */
function dotIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x - 7.5, y - 7.5) > 7) continue;
      const i = (y * size + x) * 4;
      buf[i] = 0xe0; // B
      buf[i + 1] = 0x7a; // G
      buf[i + 2] = 0x5f; // R
      buf[i + 3] = 0xff; // A
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export function createTray(extra: Electron.MenuItemConstructorOptions[] = []): void {
  tray = new Tray(dotIcon());
  tray.setToolTip('Duski');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...extra,
      { label: 'Open agent folder', click: () => void shell.openPath(AGENT_HOME) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

export function notify(title: string, content: string): void {
  tray?.displayBalloon({ title, content, iconType: 'warning' });
}
