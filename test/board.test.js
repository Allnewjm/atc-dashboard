// Run: node --test test/   (optional full JSON Schema check: NODE_PATH=<dir with ajv> node --test test/)
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const M = require('../board-model.js');
const {viewData, detectConflicts, validate} = require('../app.js');
const board = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'board.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'board.schema.json'), 'utf8'));

test('board.json passes the built-in validator', () => {
  assert.deepStrictEqual(M.validateBoard(board), []);
});

test('board.json passes board.schema.json (ajv, if installed)', (t) => {
  let Ajv, addFormats;
  try { Ajv = require('ajv/dist/2020'); addFormats = require('ajv-formats'); } catch (e) { return t.skip('ajv not installed'); }
  const ajv = new Ajv({allErrors: true, strict: false}); addFormats(ajv);
  const ok = ajv.validate(schema, board);
  assert.ok(ok, JSON.stringify(ajv.errors, null, 1));
  // and the schema rejects a broken task
  const bad = JSON.parse(JSON.stringify(board)); bad.tasks[0].status = 'NOW'; bad.tasks[1].duration = {value: 2, unit: 'weeks'};
  assert.strictEqual(ajv.validate(schema, bad), false);
});

test('migrated counts: 32 open + 24 completed from Drive, plus the new Cybercab task', () => {
  const open = board.tasks.filter(t => t.status !== 'done'), done = board.tasks.filter(t => t.status === 'done');
  assert.strictEqual(done.length, 24);
  assert.strictEqual(open.length, 33);
  const cy = board.tasks.find(t => /^Cybercab owner program watch \(through Feb 14, 2027\)$/.test(t.title));
  assert.ok(cy && cy.status === 'open' && cy.id === '#78' && /Nov 16, 2026/.test(cy.notes));
  assert.strictEqual(new Set(board.tasks.map(t => t.id)).size, board.tasks.length);
  for (const k of ['events', 'goals', 'sources', 'sectionOrder', 'label']) assert.ok(k in board, k);
});

test('no unmasked money amounts anywhere in board.json', () => {
  const txt = JSON.stringify(board);
  assert.doesNotMatch(txt, /[$€£]\s?\d/);
  assert.doesNotMatch(txt, /\d\s?(COP|USD|pesos|dollars|millones)\b/i);
});

test('maskMoney masks amounts and is idempotent', () => {
  const cases = {'Oct paid ($1,716.00, PNC)': 'Oct paid ($•••, PNC)', '$500/mo plan': '$•••/mo plan', '$280,160 COP + interest': '$••• COP + interest',
    'cuota 3.500.000 pesos': 'cuota ••• pesos', 'bill 12859 for #66 x1490': 'bill 12859 for #66 x1490', 'rate $325/hr.': 'rate $•••/hr.'};
  for (const [a, b] of Object.entries(cases)) { assert.strictEqual(M.maskMoney(a), b); assert.strictEqual(M.maskMoney(b), b); }
});

test('legacy statuses map to canonical ones and keep the original label', () => {
  assert.strictEqual(M.canonStatus('NOW'), 'in-progress'); assert.strictEqual(M.canonStatus('THIS WEEK'), 'open');
  assert.strictEqual(M.canonStatus('WAITING'), 'waiting'); assert.strictEqual(M.canonStatus('PARKED'), 'parked'); assert.strictEqual(M.canonStatus('DONE'), 'done');
  const legacy = {items: [{id: '#1', title: 'a', status: 'NOW', due: '2026-12-01', priority: 2, extra: 'kept'}, {id: '#2', title: 'b', status: 'THIS WEEK', priority: 0}],
    completed: [{id: '#3', title: 'c', completed: '2026-11-01', notes: 'x'}], events: [], goals: {}, sectionOrder: ['NOW']};
  const b = M.migrate(legacy, {now: '2026-11-14T16:00:00Z'});
  assert.deepStrictEqual(M.validateBoard(b), []);
  assert.deepStrictEqual(b.tasks.map(t => t.id), ['#2', '#1', '#3']);   // priority order, completed last
  const t1 = b.tasks.find(t => t.id === '#1');
  assert.strictEqual(t1.status, 'in-progress'); assert.strictEqual(t1.legacyStatus, 'NOW'); assert.strictEqual(t1.deadline, '2026-12-01'); assert.strictEqual(t1.extra, 'kept'); assert.ok(!('due' in t1));
  assert.strictEqual(M.statusLabel(t1), 'NOW'); assert.strictEqual(M.statusLabel({...t1, status: 'waiting'}), 'WAITING');
  assert.strictEqual(b.tasks.find(t => t.id === '#3').status, 'done');
  assert.deepStrictEqual(b.sectionOrder, ['NOW']);
});

test('reorder: move between neighbours changes only the moved task', () => {
  const tasks = [{id: 'a', sortOrder: 10}, {id: 'b', sortOrder: 20}, {id: 'c', sortOrder: 30}];
  assert.deepStrictEqual(M.reorder(tasks, 'c', 'b'), {c: 15});
  assert.deepStrictEqual(M.sorted(M.applyOrder(tasks, M.reorder(tasks, 'c', 'b'))).map(t => t.id), ['a', 'c', 'b']);
  assert.deepStrictEqual(M.reorder(tasks, 'c', 'a'), {c: 0});           // to top
  assert.deepStrictEqual(M.reorder(tasks, 'a', null), {a: 40});         // to bottom
  assert.deepStrictEqual(M.reorder(tasks, 'b', 'c'), {});               // already there
  assert.throws(() => M.reorder(tasks, 'zz', 'a'));
});

test('reorder: renumbers when there is no room left', () => {
  const tasks = [{id: 'a', sortOrder: 10}, {id: 'b', sortOrder: 10 + 1e-9}, {id: 'c', sortOrder: 30}];
  const ch = M.reorder(tasks, 'c', 'b');
  const out = M.sorted(M.applyOrder(tasks, ch));
  assert.deepStrictEqual(out.map(t => t.id), ['a', 'c', 'b']);
  assert.deepStrictEqual(out.map(t => t.sortOrder), [10, 20, 30]);
});

test('stepMove gives the beforeId for one step up/down', () => {
  const v = [{id: 'a', sortOrder: 1}, {id: 'b', sortOrder: 2}, {id: 'c', sortOrder: 3}];
  assert.strictEqual(M.stepMove(v, 'b', -1), 'a');
  assert.strictEqual(M.stepMove(v, 'a', 1), 'c');
  assert.strictEqual(M.stepMove(v, 'b', 1), null);   // to the end
  assert.strictEqual(M.stepMove(v, 'a', -1), null);  // out of range
  assert.strictEqual(M.nextId([{id: '#9'}, {id: '#50-2026-11'}, {id: '#77'}]), '#78');
});

test('change detection: newer revisions apply, stale/equal ones are ignored', () => {
  assert.strictEqual(M.decideIncoming(null, {revision: 1}), 'apply');
  assert.strictEqual(M.decideIncoming({revision: 4}, {revision: 5}), 'apply');
  assert.strictEqual(M.decideIncoming({revision: 5}, {revision: 5}), 'same');
  assert.strictEqual(M.decideIncoming({revision: 6}, {revision: 5}), 'stale');  // e.g. CDN copy older than an optimistic local edit
  assert.strictEqual(M.decideIncoming({revision: 1}, null), 'ignore');
  const a = M.serialize(board), b = M.serialize(M.bump(board, '2026-11-14T17:00:00Z'));
  assert.strictEqual(M.fingerprint(a), M.fingerprint(a));
  assert.notStrictEqual(M.fingerprint(a), M.fingerprint(b));
  assert.strictEqual(M.bump(board).revision, board.revision + 1);
});

test('views work on the canonical board', () => {
  const d = viewData(board);
  assert.strictEqual(d.items.length, 33);
  assert.ok(d.items.every(i => i.status !== 'done' && 'due' in i));
  assert.ok(Array.isArray(detectConflicts(d)));
  assert.strictEqual(validate(board).tasks.length, board.tasks.length);   // import accepts the new format
});
