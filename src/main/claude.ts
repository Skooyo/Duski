import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type ClaudeEvent =
  | { type: 'session'; id: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; output: string; isError: boolean }
  | { type: 'result'; text: string; isError: boolean };

export interface RunOptions {
  claudePath: string;
  args: string[];
  prompt: string;
  cwd: string;
  onEvent: (event: ClaudeEvent) => void;
}

export interface RunResult {
  code: number | null;
  stderr: string;
  cancelled: boolean;
}

export interface ClaudeRun {
  done: Promise<RunResult>;
  cancel(): void;
}

const STREAM_ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];

/** Reply style for Ask and Chat: ADHD-friendly structure in ASD-STE100 Simplified Technical English. */
export const REPLY_STYLE_ARGS = [
  '--append-system-prompt',
  `# Reply style
The reader has ADHD. Write your own words in ASD-STE100 Simplified Technical English.

These rules apply to your own words only. When the user asks for text (a rewrite, a translation, extracted text, code), give that text exactly as asked, in the tone asked.

## Structure
1. Put the answer or the next action in the first line. No preamble ("Sure!", "Great question", "Let me...").
2. Use a numbered list for more than one step. One action per step.
3. Use a maximum of 5 items in a list. If you have more, split them into "do now" and "later".
4. If work stays open, end with one concrete next action that takes less than 2 minutes.
5. Give time estimates in concrete units ("about 10 minutes"), never "a bit of work".
6. Show what now works in concrete terms.
7. Finish the first issue first. Offer a second issue as a separate question at the end.
8. For errors, state the cause and the fix. No "uh oh" or "there seems to be a problem".
9. No recap and no closing pleasantries ("Hope this helps", "Let me know...").
10. When the user asks you to explain, explain fully, with headers.

## Language (ASD-STE100)
- Use simple, approved words. Use one word for one meaning. No synonyms for the same idea.
- Use American English spelling. Technical names and terms are allowed.
- No idioms, slang, or figurative language.
- Use only the infinitive, imperative, simple present, simple past, and simple future. No continuous or perfect tenses.
- Prefer active voice and subject-verb-object order. Use the imperative for procedures.
- Maximum 20 words in a procedural sentence, 25 words in a descriptive sentence. One instruction per sentence.
- No hedging words that add no information ("perhaps", "might"). Keep a hedge that carries real uncertainty.`,
];

export function runClaude(o: RunOptions): ClaudeRun {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(o.claudePath, [...STREAM_ARGS, ...o.args], { cwd: o.cwd, windowsHide: true });
  } catch (err) {
    // spawn throws (not emits) for e.g. a .cmd path without a shell
    return { done: Promise.resolve({ code: null, stderr: (err as Error).message, cancelled: false }), cancel() {} };
  }
  let stderr = '';
  let pending = '';
  let cancelled = false;
  let exited = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => (stderr += d));
  child.stdout.on('data', (d: string) => {
    pending += d;
    let nl: number;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (line) parseLine(line, o.onEvent);
    }
  });
  child.stdin.on('error', () => {}); // EPIPE when the process fails to start; 'error' below reports it
  child.stdin.end(o.prompt);

  const done = new Promise<RunResult>((resolve) => {
    child.on('error', (err) => {
      exited = true;
      resolve({ code: null, stderr: stderr + err.message, cancelled });
    });
    child.on('close', (code) => {
      exited = true;
      resolve({ code, stderr, cancelled });
    });
  });

  return {
    done,
    cancel() {
      if (cancelled || exited || !child.pid) return;
      cancelled = true;
      // claude starts child processes (Bash tool); kill the whole tree.
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    },
  };
}

function parseLine(line: string, emit: (e: ClaudeEvent) => void): void {
  let m: any;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.parent_tool_use_id) return; // subagent traffic; the parent tool line covers it
  if (m.type === 'system' && m.subtype === 'init') {
    emit({ type: 'session', id: m.session_id });
  } else if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
    emit({ type: 'text', text: m.event.delta.text });
  } else if (m.type === 'assistant') {
    for (const b of m.message?.content ?? []) {
      if (b.type === 'tool_use') emit({ type: 'tool', id: b.id, name: b.name, input: b.input });
    }
  } else if (m.type === 'user') {
    for (const b of m.message?.content ?? []) {
      if (b.type === 'tool_result') emit({ type: 'tool-result', id: b.tool_use_id, output: toolText(b.content), isError: !!b.is_error });
    }
  } else if (m.type === 'result') {
    emit({ type: 'result', text: String(m.result ?? ''), isError: !!m.is_error });
  }
}

function toolText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: any) => (p?.type === 'text' ? p.text : `[${p?.type}]`)).join('\n');
  return '';
}

export function lastLines(text: string, n: number): string {
  return text.trim().split(/\r?\n/).slice(-n).join('\n');
}
