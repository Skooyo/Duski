/**
 * todo.md is a notebook: one block per line.
 * - Todo: `- [ ] Text @YYYY-MM-DD HH:MM done:YYYY-MM-DD HH:MM`. Both tags are optional and sit at the end. Times are local.
 * - Heading: `# Text`, `## Text` or `### Text`.
 * - Text: any other line, blank lines included.
 */
export interface TodoBlock {
  kind: 'todo';
  text: string;
  done: boolean;
  due: string | null;
  doneAt: string | null;
  /** Indent and bullet up to the '[', kept so a rewritten line looks as it did. */
  prefix: string;
}
export interface HeadingBlock {
  kind: 'heading';
  level: 1 | 2 | 3;
  text: string;
}
export interface TextBlock {
  kind: 'text';
  text: string;
}
export type Block = TodoBlock | HeadingBlock | TextBlock;

const ITEM = /^(\s*[-*+] \[)([ xX])\] ?(.*)$/;
const TAG = /(?:^|\s+)(@|done:)(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/;
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const HEADING = /^(#{1,3}) (.*)$/;

export function parseBlock(raw: string): Block {
  const m = ITEM.exec(raw);
  if (m) {
    let text = m[3];
    let due: string | null = null;
    let doneAt: string | null = null;
    for (let t = TAG.exec(text); t && toDate(t[2]); t = TAG.exec(text)) {
      if (t[1] === '@') due ??= t[2];
      else doneAt ??= t[2];
      text = text.slice(0, t.index);
    }
    return { kind: 'todo', text: text.trim(), done: m[2] !== ' ', due, doneAt, prefix: m[1] };
  }
  const h = HEADING.exec(raw);
  if (h) return { kind: 'heading', level: h[1].length as 1 | 2 | 3, text: h[2] };
  return { kind: 'text', text: raw };
}

export function formatBlock(b: Block): string {
  const text = b.text.replace(/[\r\n]+/g, ' '); // a newline would split the block into two lines
  if (b.kind === 'heading') return `${'#'.repeat(b.level)} ${text}`;
  if (b.kind === 'text') return text;
  const valid = (s: string | null) => (s && STAMP.test(s) && toDate(s) ? s : null);
  const due = valid(b.due);
  const doneAt = b.done ? valid(b.doneAt) : null;
  return `${b.prefix}${b.done ? 'x' : ' '}] ${text.replace(/\s+/g, ' ').trim()}${due ? ` @${due}` : ''}${doneAt ? ` done:${doneAt}` : ''}`;
}

export function parseTodos(md: string): TodoBlock[] {
  return md.split(/\r?\n/).map(parseBlock).filter((b): b is TodoBlock => b.kind === 'todo');
}

/** 'YYYY-MM-DD HH:MM' (or the 'T' form of datetime-local) → Date. Null for an impossible date like 02-30. */
export function toDate(s: string): Date | null {
  const [y, mo, d, h, mi] = s.split(/[- :T]/).map(Number);
  const date = new Date(y, mo - 1, d, h, mi);
  return date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60 ? date : null;
}

export function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
