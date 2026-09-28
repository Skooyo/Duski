import { app, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import path from 'node:path';
import { AGENT_HOME } from './config';

let tray: Tray | null = null; // module-level so it is not garbage-collected

/** Duski's head (resources/duski-icon.png, 256 px). Sizes 16 and 32 keep the tray icon sharp at 100% and 200% scaling. */
export function appIcon(): Electron.NativeImage {
  const src = nativeImage.createFromPath(path.join(__dirname, '..', 'resources', 'duski-icon.png'));
  const icon = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const size = 16 * scaleFactor;
    icon.addRepresentation({ scaleFactor, width: size, height: size, buffer: src.resize({ width: size, height: size, quality: 'best' }).toPNG() });
  }
  return icon;
}

export function createTray(extra: Electron.MenuItemConstructorOptions[] = []): void {
  tray = new Tray(appIcon());
  tray.setToolTip('Duski');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...extra,
      { label: 'Open agent folder', click: () => void shell.openPath(AGENT_HOME) },
      // Only the installed .exe can start at login; in `npm start` this would register a bare electron.exe.
      ...(app.isPackaged
        ? [{
            label: 'Start with Windows',
            type: 'checkbox' as const,
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item: Electron.MenuItem) => app.setLoginItemSettings({ openAtLogin: item.checked }),
          }]
        : []),
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

const toasts = new Set<Notification>(); // keeps a reference, or the click handler can be garbage-collected

/** Windows toast with Duski's icon. */
export function toast(title: string, body: string, onClick: () => void): void {
  const n = new Notification({ title, body, icon: nativeImage.createFromPath(path.join(__dirname, '..', 'resources', 'duski-icon.png')) });
  toasts.add(n);
  n.on('click', onClick);
  n.on('close', () => toasts.delete(n));
  n.show();
}

export function notify(title: string, content: string): void {
  tray?.displayBalloon({ title, content, iconType: 'warning' });
}
