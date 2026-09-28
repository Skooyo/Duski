// Self-check for the todo.md notebook format. Run: npm run check
import assert from 'node:assert/strict';
import { formatBlock, parseBlock, parseTodos, stamp, toDate, type TodoBlock } from './todo.ts';

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

console.log('todo format: ok');
