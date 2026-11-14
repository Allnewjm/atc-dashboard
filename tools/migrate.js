#!/usr/bin/env node
// One-off migration: legacy atc-board-data.json (items + completed) -> canonical board.json.
// Usage: node tools/migrate.js <legacy.json> [out=board.json]
// The legacy file must stay OUTSIDE this repo (it has unmasked amounts). Output is money-masked.
'use strict';
const fs = require('fs');
const M = require('../board-model.js');
const [src, out = 'board.json'] = process.argv.slice(2);
if (!src) { console.error('usage: node tools/migrate.js <legacy.json> [out]'); process.exit(2); }
const old = JSON.parse(fs.readFileSync(src, 'utf8'));
const now = new Date().toISOString();
let b = M.migrate(old, {now});
const id = M.nextId(b.tasks);
const lastOpen = Math.max(...b.tasks.filter(t => t.status !== 'done').map(t => t.sortOrder));
b.tasks.push({
  id, title: 'Cybercab owner program watch (through Feb 14, 2027)', status: 'open', duration: null,
  deadline: '2027-02-14', sortOrder: lastOpen + 5,
  notes: 'Added Nov 14, 2026 CT (Julian, by voice). Weekday 9 AM CT check routine starts Mon Nov 16, 2026 and runs through Feb 14, 2027, or ends sooner once Chicagoland/Aurora availability is clear. Each run compares Tesla Cybercab owner program terms, pricing, availability and residency/location rules against the Nov 13, 2026 terms (no Austin residency requirement stated; personal use only, no ride-hail/fleet income without Tesla approval) and also tracks Model 3/Model Y network-earning options. Goal: become a Cybercab operator earning on Tesla\'s network.',
  owner: 'Grok Bot / Julian', section: 'WAITING ON OTHERS', priority: 3, category: 'Business launch', court: 'waiting', watching: true
});
b = M.maskDeep(b);
const errs = M.validateBoard(b);
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
fs.writeFileSync(out, M.serialize(b));
const c = s => b.tasks.filter(t => (s === 'done') === (t.status === 'done')).length;
console.log(`wrote ${out}: ${b.tasks.length} tasks (${c('open')} not done, ${c('done')} done); legacy had ${old.items.length} open + ${(old.completed||[]).length} completed; new ${id}`);
