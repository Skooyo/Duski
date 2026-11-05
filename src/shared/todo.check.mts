// Self-check for the todo.md notebook format. Run: npm run check
import assert from 'node:assert/strict';
import { formatBlock, parseBlock, parseTodos, parseWhen, stamp, toDate, type TodoBlock } from './todo.ts';

const lines = [
  '# Todo',
  '',
  '- [ ] Call dentist @2026-09-29 17:00',
  '- [x] Buy milk done:2026-09-28 14:03',
  '  * [x] Both @2026-09-29 08:00 done:2026-09-28 09:15',
  '- [ ] Plain',
  '- [ ] Bad date stays text @2026-02-30 10:00',
  '## Ideas',
  'just a note',
  '#not a heading',
];

// Every line round-trips unchanged: the notebook never rewrites lines the user did not touch.
for (const raw of lines) assert.equal(formatBlock(parseBlock(raw)), raw);

assert.deepEqual(parseBlock(lines[2]), { kind: 'todo', text: 'Call dentist', done: false, due: '2026-09-29 17:00', doneAt: null, prefix: '- [' });
assert.deepEqual(parseBlock(lines[4]), { kind: 'todo', text: 'Both', done: true, due: '2026-09-29 08:00', doneAt: '2026-09-28 09:15', prefix: '  * [' });
assert.deepEqual(parseBlock(lines[6]), { kind: 'todo', text: 'Bad date stays text @2026-02-30 10:00', done: false, due: null, doneAt: null, prefix: '- [' });
assert.deepEqual(parseBlock(lines[7]), { kind: 'heading', level: 2, text: 'Ideas' });
assert.deepEqual(parseBlock(lines[9]), { kind: 'text', text: '#not a heading' });
assert.equal(parseTodos(lines.join('\r\n')).length, 5);

// Uncheck drops done:, [X] becomes [x], newlines cannot split a block, bad stamps are dropped.
const milk = parseBlock(lines[3]) as TodoBlock;
assert.equal(formatBlock({ ...milk, done: false }), '- [ ] Buy milk');
assert.equal(formatBlock(parseBlock('- [X] Up')), '- [x] Up');
assert.equal(formatBlock({ ...milk, text: 'a\nb', due: 'soon' }), '- [x] a b done:2026-09-28 14:03');
assert.equal(formatBlock({ kind: 'text', text: 'a\r\nb' }), 'a b');
assert.equal(stamp(toDate('2026-09-29T07:05')!), '2026-09-29 07:05');

// Typed reminder times, from Thursday 5 Nov 2026 21:57.
const now = new Date(2026, 10, 5, 21, 57);
const when = (t: string) => {
  const d = parseWhen(t, now);
  return d && stamp(d);
};
const cases: [string, string | null][] = [
  ['fri 3pm', '2026-11-06 15:00'],
  ['in 2h', '2026-11-05 23:57'],
  ['in 30 min', '2026-11-05 22:27'],
  ['in 3 days', '2026-11-08 21:57'],
  ['tomorrow 9', '2026-11-06 09:00'],
  ['tmrw 14:30', '2026-11-06 14:30'],
  ['20 nov 18:00', '2026-11-20 18:00'],
  ['Nov 20th', '2026-11-20 09:00'],
  ['25/12 10am', '2026-12-25 10:00'],
  ['3/1', '2027-01-03 09:00'], // passed this year: next year
  ['thu', '2026-11-12 09:00'], // today's weekday: next week
  ['noon', '2026-11-06 12:00'], // passed today: tomorrow
  ['11pm', '2026-11-05 23:00'],
  ['12am', '2026-11-06 00:00'],
  ['sat morning', '2026-11-07 09:00'],
  ['next week', '2026-11-09 09:00'],
  ['this weekend', '2026-11-07 09:00'],
  ['tonight', '2026-11-05 20:00'], // in the past: the panel says so
  ['on mon at 7.30pm', '2026-11-09 19:30'],
  ['blah', null],
  ['fri blah', null],
  ['31/02', null],
  ['25:00', null],
  ['13pm', null],
  ['', null],
];
for (const [text, expected] of cases) assert.equal(when(text), expected, text);

console.log('todo format: ok');
