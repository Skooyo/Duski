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

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PARTS: Record<string, number> = { morning: 9, noon: 12, afternoon: 15, evening: 18, night: 20 };

/**
 * A typed reminder time → Date: "fri 3pm", "in 2h", "tomorrow 9", "20 nov 18:00", "25/12" (day/month), "tonight",
 * "next week", "sat morning". A day alone means 9:00; a time alone means its next occurrence. A date with no year
 * that has passed means next year. Null when any word is not understood. The result can be in the past ("today 8am").
 */
export function parseWhen(input: string, now: Date): Date | null {
  let s = ` ${input.toLowerCase().trim()} `;
  if (!s.trim()) return null;
  const dayAt = (plus: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + plus);

  const rel = /^\s*in\s+(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)\s*$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2][0];
    if (unit === 'm' || unit === 'h') return new Date(now.getTime() + n * (unit === 'm' ? 60_000 : 3_600_000));
    const d = new Date(now);
    d.setDate(d.getDate() + Math.round(n * (unit === 'w' ? 7 : 1)));
    return d;
  }

  let day: Date | null = null;
  let hour: number | null = null;
  let min = 0;
  const take = (re: RegExp) => {
    const m = re.exec(s);
    if (m) s = s.replace(m[0], ' ');
    return m;
  };
  if (take(/\btonight\b/)) [day, hour] = [dayAt(0), 20];
  if (take(/\btoday\b/)) day = dayAt(0);
  if (take(/\b(tomorrow|tmrw|tmr)\b/)) day = dayAt(1);
  if (take(/\bnext week\b/)) day = dayAt((8 - now.getDay()) % 7 || 7); // next Monday
  if (take(/\b(this )?weekend\b/)) day = dayAt((6 - now.getDay() + 7) % 7 || 7); // next Saturday
  let m = take(/\b(?:next |this )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (m) day = dayAt((WEEKDAYS.indexOf(m[1]) - now.getDay() + 7) % 7 || 7); // "fri" on a Friday means next week

  m = take(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) ??
    take(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?\b/);
  const slash = m ? null : take(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (m || slash) {
    const [d, mo] = slash ? [+slash[1], +slash[2] - 1] : /\d/.test(m![1]) ? [+m![1], MONTHS.indexOf(m![2])] : [+m![2], MONTHS.indexOf(m![1])];
    day = new Date(now.getFullYear(), mo, d);
    if (day.getMonth() !== mo || day.getDate() !== d) return null; // 31/02
    if (day < dayAt(0)) day.setFullYear(day.getFullYear() + 1);
  }

  const part = take(/\b(morning|noon|afternoon|evening|night)\b/);
  if (part) hour = PARTS[part[1]];
  m = take(/\b(?:at )?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a|p)?\b/);
  if (m) {
    [hour, min] = [+m[1], m[2] ? +m[2] : 0];
    if (m[3] && (hour < 1 || hour > 12)) return null;
    if (m[3]?.startsWith('p') && hour < 12) hour += 12;
    if (m[3]?.startsWith('a') && hour === 12) hour = 0;
    if (hour > 23 || min > 59) return null;
  }
  if (s.replace(/\b(at|on)\b/g, '').trim()) return null; // a word we do not understand
  if (!day && hour === null) return null;

  const at = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour ?? 9, hour === null ? 0 : min);
  if (day) return at(day);
  const t = at(dayAt(0));
  return t > now ? t : at(dayAt(1));
}
