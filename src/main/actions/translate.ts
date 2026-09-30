import fs from 'node:fs';
import { lastLines } from '../claude';
import { getConfig, TEMP_DIR } from '../config';
import { showOverlay, type LensImage, type OverlayBlock } from '../overlay';
import type { ActionContext, Point } from './types';

const SYSTEM_PROMPT =
  'Translate to English. Output only the translation. Keep line breaks. If the text is already English, reply `Already English`.';

// Lens mode: one JSON line per text block, so each block can be painted over the screen as it streams in.
const LENS_PROMPT =
  'You translate the text in a screenshot to English for an overlay that covers the original text. ' +
  'Find each block of non-English text: a label, a line, or a paragraph that belongs together. ' +
  'For each block, output one line of JSON and nothing else: {"box":[left,top,right,bottom],"text":"English translation"}. ' +
  'The box is in pixels of the image and tightly covers the original text of that block. Keep the reading order. ' +
  'Skip text that is already English. Output no other text. If the image has no non-English text, output exactly: Already English';

let running: { cancel(): void } | null = null;

/**
 * Streams an English translation into a popup at `anchor`. `tools` is "" (none) or "Read".
 * With `lens`, Claude returns JSON lines with boxes: the popup shows the translated text and an overlay paints it over the area.
 */
export async function translate(
  ctx: ActionContext,
  o: { prompt: string; tools: string; anchor: Point; model?: string; lens?: LensImage },
): Promise<void> {
  running?.cancel(); // a new translation replaces a running one
  const cfg = getConfig();
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const popup = ctx.showPopup(o.anchor);
  const overlay = o.lens ? showOverlay(o.lens) : null;
  let text = '';
  let resultError = '';
  const blocks: OverlayBlock[] = [];
  let parsedLines = 0;

  // JSON lines unless Claude answered in plain text (e.g. "Already English").
  const lensMode = () => overlay !== null && /^\s*(\{|```)/.test(text);
  const lensText = () => blocks.map((b) => b.text).join('\n\n');
  const parse = (final: boolean) => {
    const lines = text.split('\n');
    const complete = final ? lines.length : lines.length - 1; // the last line may still be streaming
    for (; parsedLines < complete; parsedLines++) {
      const block = toBlock(lines[parsedLines]);
      if (!block) continue; // code fences, blank lines
      blocks.push(block);
      overlay!.add(block);
      if (blocks.length === 1) popup.enableOverlayToggle((on) => overlay!.setVisible(on));
    }
  };

  const run = ctx.runClaude({
    claudePath: cfg.claudePath,
    cwd: TEMP_DIR,
    prompt: o.prompt,
    args: [
      '--model', o.model ?? cfg.models.translate,
      '--effort', 'medium', // user modelSettings do not load here (see --setting-sources)
      '--system-prompt', o.lens ? LENS_PROMPT : SYSTEM_PROMPT,
      '--tools', o.tools,
      ...(o.tools ? ['--allowedTools', o.tools] : []),
      // Skip user plugins, hooks and MCP servers: measured 7.2 s -> 5.3 s startup.
      '--setting-sources', 'project',
      '--strict-mcp-config',
      '--no-session-persistence',
    ],
    onEvent: (e) => {
      if (e.type === 'text') {
        text += e.text;
        if (lensMode()) {
          parse(false);
          popup.update('streaming', lensText());
        } else popup.update('streaming', text);
      } else if (e.type === 'result' && e.isError) {
        resultError = e.text;
      }
    },
  });
  running = run;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    run.cancel();
  }, cfg.translateTimeoutSec * 1000);
  void popup.closed.then(() => {
    run.cancel();
    overlay?.close();
  });

  const r = await run.done;
  clearTimeout(timer);
  if (running === run) running = null;
  if (lensMode()) parse(true);
  if (!blocks.length) overlay?.close(); // nothing to paint (plain answer, error, or cancelled early)

  if (timedOut) popup.update('error', 'Timed out');
  else if (r.cancelled) return;
  else if (resultError) popup.update('error', resultError);
  else if (r.code !== 0) popup.update('error', lastLines(r.stderr, 5) || `claude exited with code ${r.code}`);
  else popup.update('done', lensMode() ? lensText() : text.trim());
}

/** One JSON line → block, or null if the line is not a valid block. */
function toBlock(line: string): OverlayBlock | null {
  try {
    const v = JSON.parse(line.trim());
    const box = v?.box;
    if (typeof v?.text !== 'string' || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null;
    return { box: box as OverlayBlock['box'], text: v.text };
  } catch {
    return null;
  }
}
