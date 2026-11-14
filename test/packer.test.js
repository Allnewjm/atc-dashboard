// Run: node --test test/packer.test.js
const test = require('node:test'), assert = require('node:assert');
const P = require('../packer.js');

const t = (id, extra) => Object.assign({
  id, title: id, status: 'open', duration: null, deadline: null, sortOrder: 10, notes: '', priority: 2
}, extra || {});

// Saturday Nov 14, 2026 12:21 CT = 18:21Z (CST, UTC-6)
const SAT = '2026-11-14T18:21:00Z';
// Friday Nov 13, 2026 8:00 AM CT = 14:00Z
const FRI_8AM = '2026-11-13T14:00:00Z';
// Friday Nov 13, 2026 4:00 PM CT = 22:00Z
const FRI_4PM = '2026-11-13T22:00:00Z';

test('durationMinutes: hours, days (8 working hours), missing default', () => {
  assert.deepStrictEqual(P.durationMinutes({duration: {value: 2, unit: 'hours'}}), {minutes: 120, estimated: false});
  assert.deepStrictEqual(P.durationMinutes({duration: {value: 1, unit: 'days'}}), {minutes: 480, estimated: false});
  assert.deepStrictEqual(P.durationMinutes({duration: {value: 0.5, unit: 'days'}}), {minutes: 240, estimated: false});
  assert.deepStrictEqual(P.durationMinutes({duration: {value: 1.5, unit: 'hours'}}), {minutes: 90, estimated: false});
  assert.deepStrictEqual(P.durationMinutes({}), {minutes: 30, estimated: true});
  assert.deepStrictEqual(P.durationMinutes({duration: null}), {minutes: 30, estimated: true});
  assert.deepStrictEqual(P.durationMinutes({duration: {value: 2, unit: 'weeks'}}), {minutes: 30, estimated: true});
  assert.deepStrictEqual(P.durationMinutes({duration: null}, 45), {minutes: 45, estimated: true});
});

test('ceilTo5Min rounds up, leaves exact 5-min times alone', () => {
  assert.strictEqual(P.ceilTo5Min(new Date('2026-11-14T18:21:00Z')).toISOString(), '2026-11-14T18:25:00.000Z');
  assert.strictEqual(P.ceilTo5Min(new Date('2026-11-14T18:25:00Z')).toISOString(), '2026-11-14T18:25:00.000Z');
  assert.strictEqual(P.ceilTo5Min(new Date('2026-11-14T18:25:01Z')).toISOString(), '2026-11-14T18:30:00.000Z');
});

test('buffer shrinks packable capacity', () => {
  const start = new Date('2026-11-13T15:00:00Z'); // Fri 9:00 CT
  const end = P.addMinutes(start, 100);
  const tasks = [t('#1', {duration: {value: 30, unit: 'hours'}}), // wait, 30 hours would overflow; use minutes via hours fraction
  ];
  // 30 + 30 + 30 min tasks, capacity 100, buffer 15% → packable 85 → two fit (60), one overflow (30)
  const three = [1,2,3].map(n => t('#'+n, {duration: {value: 0.5, unit: 'hours'}, sortOrder: n * 10}));
  const r = P.packDay({tasks: three, start, end, buffer: 0.15, now: start});
  assert.strictEqual(r.capacityMinutes, 100);
  assert.strictEqual(r.packableMinutes, 85);
  assert.strictEqual(r.packed.length, 2);
  assert.strictEqual(r.packedMinutes, 60);
  assert.strictEqual(r.spareMinutes, 25);
  assert.strictEqual(r.overflow.length, 1);
  assert.strictEqual(r.overflow[0].id, '#3');
  assert.strictEqual(r.overflowMinutes, 30);
  assert.strictEqual(r.verdict.kind, 'over');
  assert.strictEqual(r.verdict.text, 'Over by 30 min');
});

test('fits verdict when everything packs, with spare minutes', () => {
  const start = new Date('2026-11-13T15:00:00Z');
  const end = P.addMinutes(start, 100);
  const tasks = [t('#1', {duration: {value: 0.5, unit: 'hours'}})];
  const r = P.packDay({tasks, start, end, buffer: 0.15, now: start});
  assert.strictEqual(r.packed.length, 1);
  assert.strictEqual(r.overflow.length, 0);
  assert.strictEqual(r.spareMinutes, 55);
  assert.strictEqual(r.verdict.kind, 'fits');
  assert.strictEqual(r.verdict.text, 'Fits, 55 min to spare');
});

test('overflow: leftover tasks that do not fit packable time', () => {
  const start = new Date('2026-11-13T15:00:00Z');
  const end = P.addMinutes(start, 60);
  const tasks = [
    t('#1', {duration: {value: 1, unit: 'hours'}, sortOrder: 10}),
    t('#2', {duration: {value: 1, unit: 'hours'}, sortOrder: 20})
  ];
  const r = P.packDay({tasks, start, end, buffer: 0, now: start});
  assert.strictEqual(r.packableMinutes, 60);
  assert.deepStrictEqual(r.packed.map(p => p.task.id), ['#1']);
  assert.deepStrictEqual(r.overflow.map(x => x.id), ['#2']);
  assert.strictEqual(r.verdict.text, 'Over by 60 min');
});

test('business-hours tasks defer on a weekend, with next window Mon 9:00 AM CT', () => {
  const now = new Date(SAT);
  const start = P.ceilTo5Min(now); // 12:25 CT
  const end = P.parseClockOnDay(now, '21:00', P.TZ);
  const tasks = [
    t('#77', {title: 'Volt title', businessHours: true, duration: {value: 4, unit: 'hours'}, status: 'in-progress', priority: -1}),
    t('#10', {title: 'Email', duration: {value: 0.5, unit: 'hours'}, sortOrder: 20})
  ];
  const r = P.packDay({tasks, start, end, buffer: 0.15, now});
  assert.strictEqual(r.businessWindow, null);
  assert.deepStrictEqual(r.needsBusinessHours.map(x => x.id), ['#77']);
  assert.deepStrictEqual(r.packed.map(p => p.task.id), ['#10']);
  assert.strictEqual(r.overflow.length, 0);
  assert.ok(r.verdict.kind === 'fits');
  assert.strictEqual(r.nextBusinessLabel, 'Mon 9:00 AM CT');
  assert.strictEqual(r.nextBusinessOpen.toISOString(), '2026-11-16T15:00:00.000Z'); // Mon 9:00 CST
});

test('weekday: business-hours tasks land in 9–5 CT, others can go before', () => {
  const now = new Date(FRI_8AM); // 8:00 CT
  const start = P.ceilTo5Min(now);
  const end = P.parseClockOnDay(now, '21:00', P.TZ);
  const tasks = [
    t('#b', {title: 'Bank', businessHours: true, duration: {value: 2, unit: 'hours'}, sortOrder: 10, priority: 2}),
    t('#e', {title: 'Email', duration: {value: 0.5, unit: 'hours'}, sortOrder: 20, priority: 2})
  ];
  const r = P.packDay({tasks, start, end, buffer: 0, now});
  assert.ok(r.businessWindow);
  const bh = r.packed.find(p => p.task.id === '#b');
  const em = r.packed.find(p => p.task.id === '#e');
  assert.ok(bh && em);
  // Email can start at 8:00; bank must wait until 9:00.
  assert.strictEqual(em.start.toISOString(), '2026-11-13T14:00:00.000Z'); // 8:00 CT
  assert.strictEqual(em.end.toISOString(), '2026-11-13T14:30:00.000Z');
  assert.strictEqual(bh.start.toISOString(), '2026-11-13T15:00:00.000Z'); // 9:00 CT
  assert.strictEqual(bh.end.toISOString(), '2026-11-13T17:00:00.000Z');
  assert.strictEqual(r.needsBusinessHours.length, 0);
});

test('weekday: a business-hours task that does not fit the remaining 9–5 window is deferred, not overflow', () => {
  const now = new Date(FRI_4PM); // 4:00 PM CT, only 60 min of BH window left
  const start = P.ceilTo5Min(now);
  const end = P.parseClockOnDay(now, '21:00', P.TZ);
  const tasks = [
    t('#b', {businessHours: true, duration: {value: 2, unit: 'hours'}, sortOrder: 10}),
    t('#e', {duration: {value: 0.5, unit: 'hours'}, sortOrder: 20})
  ];
  const r = P.packDay({tasks, start, end, buffer: 0, now});
  assert.deepStrictEqual(r.needsBusinessHours.map(x => x.id), ['#b']);
  assert.deepStrictEqual(r.packed.map(p => p.task.id), ['#e']);
  assert.strictEqual(r.overflow.length, 0);
  // Next window is Monday 9:00 (Fri 4pm, today 9am already passed)
  assert.strictEqual(r.nextBusinessLabel, 'Mon 9:00 AM CT');
});

test('sort: overdue and due today first, then priority -1, then sortOrder (beats ordinary priority), then shorter', () => {
  const today = '2026-11-13';
  const items = [
    t('#late', {deadline: '2026-12-01', minutes: 10, sortOrder: 10, priority: 0, status: 'open'}),
    t('#short', {deadline: '2026-10-01', minutes: 10, sortOrder: 50, priority: 2, status: 'open'}),
    t('#long', {deadline: '2026-10-01', minutes: 60, sortOrder: 50, priority: 2, status: 'open'}),
    t('#today', {deadline: '2026-11-13', minutes: 10, sortOrder: 10, priority: 2, status: 'open'}),
    t('#prog', {deadline: '2026-12-01', minutes: 10, sortOrder: 10, priority: 2, status: 'in-progress'}),
    t('#pri', {deadline: '2026-12-01', minutes: 10, sortOrder: 10, priority: -1, status: 'open'}),
    t('#order', {deadline: '2026-10-01', minutes: 10, sortOrder: 5, priority: 2, status: 'open'})
  ];
  const sorted = items.slice().sort((a, b) => P.comparePackOrder(a, b, today));
  // overdue (#order so=5, then #short/#long so=50 with shorter first), due today, then -1, then same so=10 by id
  assert.deepStrictEqual(sorted.map(x => x.id), ['#order', '#short', '#long', '#today', '#pri', '#late', '#prog']);
});

test('sort: board order beats ordinary priority; priority -1 still jumps ahead; in-progress does not', () => {
  const today = '2026-11-13';
  const items = [
    t('#lowPriFirst', {sortOrder: 10, priority: 3, status: 'open'}),
    t('#highPriLater', {sortOrder: 20, priority: 0, status: 'open'}),
    t('#inProgLater', {sortOrder: 30, priority: 2, status: 'in-progress'}),
    t('#topLast', {sortOrder: 40, priority: -1, status: 'open'})
  ];
  const sorted = items.slice().sort((a, b) => P.comparePackOrder(a, b, today));
  assert.deepStrictEqual(sorted.map(x => x.id), ['#topLast', '#lowPriFirst', '#highPriLater', '#inProgLater']);
});

test('packDay packs in the new board-order ranking, not numeric priority', () => {
  const start = new Date('2026-11-13T15:00:00Z');
  const end = P.addMinutes(start, 90);
  const tasks = [
    t('#later', {duration: {value: 0.5, unit: 'hours'}, sortOrder: 20, priority: 0}),
    t('#first', {duration: {value: 0.5, unit: 'hours'}, sortOrder: 10, priority: 3})
  ];
  const r = P.packDay({tasks, start, end, buffer: 0, now: start});
  assert.deepStrictEqual(r.packed.map(p => p.task.id), ['#first', '#later']);
});

test('candidates skip done and parked, and waiting unless includeWaiting', () => {
  const tasks = [
    t('#o', {status: 'open'}), t('#i', {status: 'in-progress'}), t('#w', {status: 'waiting'}),
    t('#d', {status: 'done'}), t('#p', {status: 'parked'})
  ];
  assert.deepStrictEqual(P.candidates(tasks).map(x => x.id), ['#o', '#i']);
  assert.deepStrictEqual(P.candidates(tasks, {includeWaiting: true}).map(x => x.id), ['#o', '#i', '#w']);
});

test('missing duration uses 30 min default and is marked estimated; day-length tasks convert to 8h', () => {
  const start = new Date('2026-11-13T15:00:00Z');
  const end = P.addMinutes(start, 12 * 60);
  const tasks = [
    t('#a', {duration: null, sortOrder: 10}),
    t('#d', {duration: {value: 1, unit: 'days'}, sortOrder: 20})
  ];
  const r = P.packDay({tasks, start, end, buffer: 0, now: start});
  assert.strictEqual(r.packed[0].task.id, '#a');
  assert.strictEqual(r.packed[0].task.minutes, 30);
  assert.strictEqual(r.packed[0].task.estimated, true);
  assert.strictEqual(minutesOf(r, '#d'), 480);
  assert.strictEqual(r.packed.find(p => p.task.id === '#d').task.estimated, false);
});

function minutesOf(r, id){
  const p = r.packed.find(x => x.task.id === id);
  return p ? P.minutesBetween(p.start, p.end) : null;
}

test('dayWindow: now rounds up; hoursAvailable overrides end of day', () => {
  const now = new Date(SAT); // 12:21 CT
  const a = P.dayWindow(now, {endOfDay: '21:00'});
  assert.strictEqual(a.start.toISOString(), '2026-11-14T18:25:00.000Z');
  assert.strictEqual(a.end.toISOString(), '2026-11-15T03:00:00.000Z'); // 21:00 CT
  const b = P.dayWindow(now, {hoursAvailable: 2});
  assert.strictEqual(P.minutesBetween(b.start, b.end), 120);
  const c = P.dayWindow(now, {startMode: 'fixed', start: '13:00', endOfDay: '21:00'});
  assert.strictEqual(c.start.toISOString(), '2026-11-14T19:00:00.000Z'); // 13:00 CT
});
