import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('duski', {
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, fn: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => fn(...args));
  },
  // Electron removed File.path; this is the supported way to get a dropped file's path. '' for pasted data.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
});
