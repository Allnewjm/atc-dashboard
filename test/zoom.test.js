// Run: node --test test/*.test.js
const test = require('node:test'), assert = require('node:assert');
const {clampView, zoomAt, blipPos, boardItems} = require('../app.js');

test('zoom is clamped to 0.5x..4x and pan is locked at or below 1x', () => {
  assert.deepStrictEqual(clampView({z: 10, x: 0, y: 0}).z, 4);
  assert.deepStrictEqual(clampView({z: 0.1, x: 30, y: -30}), {z: 0.5, x: 0, y: 0});
  assert.deepStrictEqual(clampView(null), {z: 1, x: 0, y: 0});
});

test('zooming in spreads bunched blips apart', () => {
  const a = blipPos({z: 1, x: 0, y: 0}, 10, 0), b = blipPos({z: 1, x: 0, y: 0}, 12, 0);
  const v = zoomAt({z: 1, x: 0, y: 0}, 2);
  const a2 = blipPos(v, 10, 0), b2 = blipPos(v, 12, 0);
  assert.ok(Math.abs(b2.left - a2.left) > Math.abs(b.left - a.left) * 1.9);
});

test('zooming at a point keeps that point fixed', () => {
  const v = zoomAt({z: 1, x: 0, y: 0}, 2, 20, -10);
  const p = blipPos(v, 20, -10);
  assert.ok(Math.abs(p.left - 70) < 1e-9 && Math.abs(p.top - 40) < 1e-9);
});

test('board filter unchanged', () => {
  const items = [{status: 'NOW'}, {status: 'PARKED'}, {status: 'DONE'}];
  assert.strictEqual(boardItems(items, false).length, 1);
  assert.strictEqual(boardItems(items, true).length, 2);
});
