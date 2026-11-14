// Run: node --test test/views.test.js
const test = require('node:test'), assert = require('node:assert');
const M = require('../board-model.js');
const {viewData, scopeLists, addDaysKey} = require('../app.js');

const task = (id, extra) => Object.assign({
  id, title: id, status: 'open', duration: null, deadline: null, sortOrder: 10, notes: '', priority: 2
}, extra || {});

test('addDaysKey walks calendar days', () => {
  assert.strictEqual(addDaysKey('2026-11-14', 7), '2026-11-21');
  assert.strictEqual(addDaysKey('2026-11-29', 7), '2026-12-06');
});

test('viewData items follow sortOrder even when priorities differ', () => {
  const board = {
    schemaVersion: 1, revision: 1, updatedAt: '2026-11-14T00:00:00Z',
    tasks: [
      task('#a', {sortOrder: 20, priority: 0, deadline: '2026-11-15'}),
      task('#b', {sortOrder: 10, priority: 3, deadline: '2026-12-01'}),
      task('#done', {sortOrder: 5, status: 'done', priority: 0})
    ]
  };
  assert.deepStrictEqual(viewData(board).items.map(i => i.id), ['#b', '#a']);
});

test('scope lists follow board order, not the old priority/deadline score', () => {
  const today = '2026-11-14';
  const items = [
    {id: '#low', title: 'low pri earlier due', status: 'open', priority: 2, due: '2026-11-16', sortOrder: 30},
    {id: '#high', title: 'high pri later due', status: 'open', priority: 0, due: '2026-11-20', sortOrder: 10},
    {id: '#mid', title: 'mid', status: 'open', priority: 1, due: '2026-11-18', sortOrder: 20},
    {id: '#hold', title: 'holding', status: 'open', priority: 4, due: null, sortOrder: 5}
  ];
  const {now, rest, week} = scopeLists(items, today);
  assert.strictEqual(week, '2026-11-21');
  // Old score would have put #high (priority 0) first, then #mid, then #low.
  // Board order: #high (10), #mid (20), #low (30). #hold stays in HOLDING PATTERN.
  assert.deepStrictEqual(now.map(i => i.id), ['#high', '#mid', '#low']);
  assert.deepStrictEqual(rest.map(i => i.id), ['#hold']);
});

test('scope lists update when sortOrder changes (same membership)', () => {
  const today = '2026-11-14';
  const items = [
    {id: '#a', title: 'a', status: 'open', priority: 2, due: '2026-11-16', sortOrder: 10},
    {id: '#b', title: 'b', status: 'open', priority: 0, due: '2026-11-16', sortOrder: 20}
  ];
  assert.deepStrictEqual(scopeLists(items, today).now.map(i => i.id), ['#a', '#b']);
  const moved = M.applyOrder(items, M.reorder(items, '#b', '#a'));
  assert.deepStrictEqual(scopeLists(moved, today).now.map(i => i.id), ['#b', '#a']);
});
