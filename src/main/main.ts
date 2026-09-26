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
  // Every window has the preload bridge (which can start claude with full tools), so no window may load remote content.
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  void app.whenReady().then(start);
}

function start(): void {
  app.setAppUserModelId('com.duski.app'); // matches build.appId, so Windows groups balloons and taskbar under Duski
  const configError = loadConfig();
  const cfg = getConfig();
  createTray([{ label: 'Open chat', click: openChat }, { type: 'separator' }]);
  if (configError) notify('Duski config', configError);
  const claudeMissing = () => notify('Claude Code not found', `"${cfg.claudePath} --version" failed. Install Claude Code, or run "claude" once to log in.`);
  try {
    execFile(cfg.claudePath, ['--version'], { timeout: 15_000, windowsHide: true }, (err) => err && claudeMissing());
  } catch {
    claudeMissing(); // e.g. EINVAL for a .cmd path; startup must continue
  }

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
