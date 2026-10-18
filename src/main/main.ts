import { app, globalShortcut } from 'electron';
import { execFile } from 'node:child_process';
import { actions } from './actions';
import { initAskIpc, showAsk, showAskWindow } from './ask';
import type { ActionContext, Point } from './actions/types';
import { getSelectedText } from './capture';
import { initChatIpc, openChat } from './chat';
import { runClaude } from './claude';
import { AGENT_HOME, agentHomeWarning, changeAgentHome, getConfig, loadConfig } from './config';
import { initPie, togglePie } from './pie';
import { initPopupIpc, showPopup } from './popup';
import { selectRegion } from './region';
import { initTodos, openTodo } from './todo';
import { createTray, notify, toast } from './tray';

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

const APP_ID = 'com.duski.app'; // matches build.appId, so Windows groups balloons and taskbar under Duski

function start(): void {
  app.setAppUserModelId(APP_ID);
  repairLoginItem();
  const configError = loadConfig();
  const cfg = getConfig();
  createTray([{ label: 'Open chat', click: openChat }, { label: 'Open todo', click: openTodo }, { label: 'Show Ask window', click: showAskWindow }, { type: 'separator' }]);
  if (configError) notify('Duski config', configError);
  const homeWarning = agentHomeWarning();
  if (homeWarning) toast('Duski agent folder', homeWarning, () => void changeAgentHome());
  const claudeMissing = () => notify('Claude Code not found', `"${cfg.claudePath} --version" failed. Install Claude Code, or run "claude" once to log in.`);
  try {
    execFile(cfg.claudePath, ['--version'], { timeout: 15_000, windowsHide: true }, (err) => err && claudeMissing());
  } catch {
    claudeMissing(); // e.g. EINVAL for a .cmd path; startup must continue
  }

  initPopupIpc();
  initChatIpc();
  initTodos();
  initAskIpc();
  initPie(actions, (action, cursor) => {
    action.run(contextAt(cursor)).catch((err: unknown) => {
      showPopup(cursor).update('error', err instanceof Error ? err.message : String(err));
    });
  });
  registerHotkey(cfg.hotkey);
}

/**
 * "Start with Windows" is a Run registry value that holds the path of Duski.exe. A reinstall to another folder
 * leaves it on the old, deleted exe: Task Manager still shows it as enabled, but nothing starts. Point it at this exe.
 * Electron's launchItems only lists values that already match this exe, so read the registry directly.
 */
function repairLoginItem(): void {
  if (!app.isPackaged) return; // `npm start` would register a bare electron.exe
  const query = (key: string, cb: (out: string) => void) =>
    execFile('reg', ['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\${key}`, '/v', APP_ID], { windowsHide: true }, (err, out) => cb(err ? '' : out));
  query('Run', (run) => {
    if (!run || run.toLowerCase().includes(process.execPath.toLowerCase())) return; // off, or already this exe
    // Keep the user's Task Manager choice: the first byte of the StartupApproved value is even when enabled.
    query('Explorer\\StartupApproved\\Run', (approved) => {
      const flag = /REG_BINARY\s+([0-9A-F]{2})/i.exec(approved);
      app.setLoginItemSettings({ openAtLogin: true, enabled: !flag || parseInt(flag[1], 16) % 2 === 0 });
    });
  });
}

function contextAt(cursor: Point): ActionContext {
  return { cursor, getSelectedText, selectRegion, runClaude, showPopup, openChat, openTodo, showAsk };
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
