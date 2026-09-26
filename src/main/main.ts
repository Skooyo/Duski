import { app, globalShortcut } from 'electron';
import { execFile } from 'node:child_process';
import { actions } from './actions';
import type { ActionContext, Point } from './actions/types';
import { getSelectedText } from './capture';
import { initChatIpc, openChat } from './chat';
import { runClaude } from './claude';
import { AGENT_HOME, getConfig, loadConfig } from './config';
import { initPie, togglePie } from './pie';
import { initPopupIpc, showPopup } from './popup';
import { selectRegion } from './region';
import { createTray, notify } from './tray';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => {
    // Stay alive in the tray.
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  void app.whenReady().then(start);
}

function start(): void {
  const configError = loadConfig();
  const cfg = getConfig();
  createTray([{ label: 'Open chat', click: openChat }, { type: 'separator' }]);
  if (configError) notify('Duski config', configError);
  execFile(cfg.claudePath, ['--version'], { timeout: 15_000, windowsHide: true }, (err) => {
    if (err) notify('Claude Code not found', `"${cfg.claudePath} --version" failed. Install Claude Code, or run "claude" once to log in.`);
  });

  initPopupIpc();
  initChatIpc();
  initPie(actions, (action, cursor) => {
    action.run(contextAt(cursor)).catch((err: unknown) => {
      showPopup(cursor).update('error', err instanceof Error ? err.message : String(err));
    });
  });
  registerHotkey(cfg.hotkey);
}

function contextAt(cursor: Point): ActionContext {
  return { cursor, getSelectedText, selectRegion, runClaude, showPopup, openChat };
}

function registerHotkey(hotkey: string): void {
  let ok = false;
  try {
    ok = globalShortcut.register(hotkey, togglePie);
  } catch {
    ok = false; // malformed accelerator string
  }
  if (!ok) notify('Hotkey not available', `Duski could not register "${hotkey}". Change "hotkey" in ${AGENT_HOME}\\config.json and restart Duski.`);
}
