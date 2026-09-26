import { clipboard, ClipboardItem } from 'electron';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends Ctrl+C to the foreground app and reads the copied text. Restores the old clipboard. */
export async function getSelectedText(): Promise<string> {
  const saved = await snapshotClipboard();
  clipboard.clear();
  try {
    const { keyboard, Key } = await import('@nut-tree-fork/nut-js');
    keyboard.config.autoDelayMs = 10;
    await keyboard.pressKey(Key.LeftControl, Key.C);
    await keyboard.releaseKey(Key.LeftControl, Key.C);
    for (let waited = 0; waited <= 500; waited += 25) {
      const text = await clipboard.readText();
      if (text) return text;
      await sleep(25);
    }
    return '';
  } finally {
    if (saved.length) await clipboard.write(saved);
    else clipboard.clear();
  }
}

/** Reads every format eagerly: lazy getType() promises would read the clipboard after we clear it. */
async function snapshotClipboard(): Promise<ClipboardItem[]> {
  // ponytail: keeps the MIME types clipboard.read() exposes; private app formats (e.g. Office internals) are lost
  const items: ClipboardItem[] = [];
  for (const item of await clipboard.read()) {
    const data: Record<string, Blob> = {};
    for (const type of item.types) {
      if (type === 'electron application/bookmark') continue;
      try {
        data[type] = (await item.getType(type)) as Blob;
      } catch {
        // format vanished between read() and getType(); skip it
      }
    }
    if (Object.keys(data).length) items.push(new ClipboardItem(data));
  }
  return items;
}
