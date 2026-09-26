import { execFile, spawn } from 'node:child_process';

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

export function runClaude(o: RunOptions): ClaudeRun {
  const child = spawn(o.claudePath, [...STREAM_ARGS, ...o.args], { cwd: o.cwd, windowsHide: true });
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
