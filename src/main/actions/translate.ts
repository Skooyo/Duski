import fs from 'node:fs';
import { lastLines } from '../claude';
import { getConfig, TEMP_DIR } from '../config';
import type { ActionContext, Point } from './types';

const SYSTEM_PROMPT =
  'Translate to English. Output only the translation. Keep line breaks. If the text is already English, reply `Already English`.';

let running: { cancel(): void } | null = null;

/** Streams an English translation into a popup at `anchor`. `tools` is "" (none) or "Read". */
export async function translate(ctx: ActionContext, o: { prompt: string; tools: string; anchor: Point }): Promise<void> {
  running?.cancel(); // a new translation replaces a running one
  const cfg = getConfig();
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const popup = ctx.showPopup(o.anchor);
  let text = '';
  let resultError = '';

  const run = ctx.runClaude({
    claudePath: cfg.claudePath,
    cwd: TEMP_DIR,
    prompt: o.prompt,
    args: [
      '--model', cfg.models.translate,
      '--system-prompt', SYSTEM_PROMPT,
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
        popup.update('streaming', text);
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
  void popup.closed.then(() => run.cancel());

  const r = await run.done;
  clearTimeout(timer);
  if (running === run) running = null;

  if (timedOut) popup.update('error', 'Timed out');
  else if (r.cancelled) return;
  else if (resultError) popup.update('error', resultError);
  else if (r.code !== 0) popup.update('error', lastLines(r.stderr, 5) || `claude exited with code ${r.code}`);
  else popup.update('done', text.trim());
}
