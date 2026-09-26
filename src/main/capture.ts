import { clipboard, ClipboardItem } from 'electron';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let chain: Promise<unknown> = Promise.resolve();

/** Sends Ctrl+C to the foreground app and reads the copied text. Restores the old clipboard. */
export function getSelectedText(): Promise<string> {
  // One capture at a time: an overlapping one would snapshot the cleared clipboard and lose the user's data.
  const next = chain.then(captureOnce, captureOnce);
  chain = next.catch(() => {});
  return next;
}

async function captureOnce(): Promise<string> {
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
    try {
      if (saved.length) await clipboard.write(saved);
      else clipboard.clear();
    } catch {
      // restore failed; keep the copied selection rather than hide the translation behind an error
    }
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
