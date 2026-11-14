'use strict';
// Canonical board model shared by the browser (window.BoardModel) and node (require).
// See board.schema.json and README "Board data" for the format.
(function(root){
  const SCHEMA_VERSION = 1;
  const STATUSES = ['open','in-progress','waiting','done','parked'];
  const LEGACY_MAP = {'NOW':'in-progress','THIS WEEK':'open','WAITING':'waiting','PARKED':'parked','DONE':'done'};

  // Map any status string (legacy NOW/THIS WEEK/... or canonical) to a canonical status.
  function canonStatus(s){
    if (s == null || s === '') return 'open';
    const t = String(s).trim();
    if (STATUSES.includes(t.toLowerCase())) return t.toLowerCase();
    const u = t.toUpperCase();
    if (LEGACY_MAP[u]) return LEGACY_MAP[u];
    if (/DONE|CLOSED|COMPLETE/.test(u)) return 'done';
    if (/PARK/.test(u)) return 'parked';
    if (/WAIT/.test(u)) return 'waiting';
    if (/NOW|PROGRESS/.test(u)) return 'in-progress';
    return 'open';
  }
  // Label shown in the UI: the legacy label while it still agrees with the canonical status.
  function statusLabel(t){
    if (t.legacyStatus && canonStatus(t.legacyStatus) === t.status) return t.legacyStatus;
    return String(t.status || 'open').toUpperCase();
  }

  // Mask money amounts ($1,716.00, $500/mo, $280,160 COP, 3.5 millones, 1200 USD ...). Idempotent.
  const MONEY_SYM = /(?:US\$|COP\s?\$|C\$|\$|€|£)\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:k|K|M|MM|million|millones|mil)\b)?/g;
  const MONEY_WORD = /\b(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?\s?(?:millones|million|mil pesos|pesos|COP|USD|dollars|dólares|dolares)\b/gi;
  function maskMoney(s){
    if (typeof s !== 'string') return s;
    return s.replace(MONEY_SYM, '$•••').replace(MONEY_WORD, m => '••• ' + m.replace(/^[\d.,\s]+/, ''));
  }
  function maskDeep(o){
    if (typeof o === 'string') return maskMoney(o);
    if (Array.isArray(o)) return o.map(maskDeep);
    if (o && typeof o === 'object'){ const r = {}; for (const k of Object.keys(o)) r[k] = maskDeep(o[k]); return r; }
    return o;
  }

  // Legacy board ({items, completed, ...}) -> canonical board ({schemaVersion, tasks, ...}).
  function migrate(old, opts){
    opts = opts || {};
    if (old && Array.isArray(old.tasks) && old.schemaVersion) return old;
    if (!old || !Array.isArray(old.items)) throw new Error('JSON needs an "items" or "tasks" array');
    const toTask = (i, extra) => {
      const t = {};
      t.id = String(i.id);
      t.title = i.title || '';
      const legacy = i.status != null ? i.status : null;
      t.status = extra.done ? 'done' : canonStatus(legacy);
      if (legacy != null && String(legacy) !== t.status) t.legacyStatus = String(legacy);
      t.duration = i.duration === undefined ? null : i.duration;
      t.deadline = i.deadline || i.due || null;
      t.sortOrder = extra.sortOrder;
      t.notes = i.notes || '';
      for (const k of Object.keys(i)) if (!(k in t) && k !== 'due' && k !== 'status') t[k] = i[k];
      return t;
    };
    const open = old.items.map((i, n) => ({i, n}))
      .sort((a, b) => ((a.i.priority ?? 4) - (b.i.priority ?? 4)) || (a.n - b.n));
    const tasks = open.map((x, k) => toTask(x.i, {sortOrder: (k + 1) * 10}));
    const base = tasks.length * 10;
    (old.completed || []).forEach((i, k) => tasks.push(toTask(i, {done: true, sortOrder: base + (k + 1) * 10})));
    const out = {schemaVersion: SCHEMA_VERSION, revision: 1, updatedAt: opts.now || new Date().toISOString()};
    for (const k of Object.keys(old)) if (k !== 'items' && k !== 'completed') out[k] = old[k];
    out.tasks = tasks;
    return out;
  }

  // Lightweight structural validation (mirrors board.schema.json). Returns a list of error strings.
  function validateBoard(b){
    const e = [];
    if (!b || typeof b !== 'object') return ['board must be an object'];
    if (b.schemaVersion !== SCHEMA_VERSION) e.push('schemaVersion must be ' + SCHEMA_VERSION);
    if (!Number.isInteger(b.revision) || b.revision < 1) e.push('revision must be a positive integer');
    if (typeof b.updatedAt !== 'string' || isNaN(Date.parse(b.updatedAt))) e.push('updatedAt must be an ISO date-time');
    if (!Array.isArray(b.tasks)) return e.concat('tasks must be an array');
    const ids = new Set();
    b.tasks.forEach((t, n) => {
      const p = `tasks[${n}] (${t && t.id})`;
      if (!t || typeof t !== 'object') return e.push(p + ' must be an object');
      if (typeof t.id !== 'string' || !t.id) e.push(p + ' id must be a non-empty string');
      else if (ids.has(t.id)) e.push(p + ' duplicate id'); else ids.add(t.id);
      if (typeof t.title !== 'string') e.push(p + ' title must be a string');
      if (!STATUSES.includes(t.status)) e.push(p + ' bad status ' + t.status);
      if (t.duration !== null && !(t.duration && typeof t.duration.value === 'number' && t.duration.value >= 0 && ['hours','days'].includes(t.duration.unit))) e.push(p + ' duration must be null or {value>=0, unit: hours|days}');
      if (t.deadline !== null && !/^\d{4}-\d{2}-\d{2}$/.test(t.deadline || '')) e.push(p + ' deadline must be null or YYYY-MM-DD');
      if (typeof t.sortOrder !== 'number' || !isFinite(t.sortOrder)) e.push(p + ' sortOrder must be a number');
      if (typeof t.notes !== 'string') e.push(p + ' notes must be a string');
    });
    return e;
  }

  // Ordering. Returns tasks sorted by sortOrder (ties by id) without mutating.
  function sorted(tasks){ return tasks.slice().sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.id).localeCompare(String(b.id))); }
  // Move task `id` so it sits just before `beforeId` (null = end) among `tasks`.
  // Returns {id: newSortOrder} for every task whose sortOrder changes (usually just one).
  function reorder(tasks, id, beforeId){
    const list = sorted(tasks).filter(t => t.id !== id);
    if (!tasks.some(t => t.id === id)) throw new Error('unknown task ' + id);
    let idx = beforeId == null ? list.length : list.findIndex(t => t.id === beforeId);
    if (idx < 0) throw new Error('unknown task ' + beforeId);
    const prev = list[idx - 1], next = list[idx];
    let v;
    if (!prev && !next) v = 10;
    else if (!prev) v = next.sortOrder - 10;
    else if (!next) v = prev.sortOrder + 10;
    else v = (prev.sortOrder + next.sortOrder) / 2;
    const tooTight = prev && next && (next.sortOrder - prev.sortOrder < 1e-6);
    if (!tooTight){ const cur = tasks.find(t => t.id === id); return cur.sortOrder === v ? {} : {[id]: v}; }
    // No room left between neighbours: renumber everything 10, 20, 30 ...
    list.splice(idx, 0, tasks.find(t => t.id === id));
    const ch = {};
    list.forEach((t, k) => { if (t.sortOrder !== (k + 1) * 10) ch[t.id] = (k + 1) * 10; });
    return ch;
  }
  function applyOrder(tasks, changes){ return tasks.map(t => (t.id in changes) ? Object.assign({}, t, {sortOrder: changes[t.id]}) : t); }
  // Move one step up (-1) or down (+1) in the list `visible` (a subset of tasks, e.g. one column).
  function stepMove(visible, id, dir){
    const l = sorted(visible); const k = l.findIndex(t => t.id === id); const j = k + dir;
    if (k < 0 || j < 0 || j >= l.length) return null;
    return dir < 0 ? l[j].id : (l[j + 1] ? l[j + 1].id : null);  // beforeId
  }
  function nextId(tasks){
    const n = Math.max(0, ...tasks.map(t => parseInt(String(t.id).replace(/^#/, ''), 10)).filter(x => !isNaN(x)));
    return '#' + (n + 1);
  }

  // Change detection for polling. A fetched board replaces the shown one only if it is a
  // newer revision (protects optimistic local edits from stale CDN copies).
  function decideIncoming(current, incoming){
    if (!incoming) return 'ignore';
    if (!current) return 'apply';
    const a = current.revision || 0, b = incoming.revision || 0;
    if (b > a) return 'apply';
    if (b < a) return 'stale';
    return 'same';
  }
  // Cheap fingerprint of fetched text, used when no ETag/sha is available.
  function fingerprint(text){ let h = 2166136261; for (let i = 0; i < text.length; i++){ h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ':' + text.length; }

  // Produce the next revision of a board after a local mutation.
  function bump(board, now){ return Object.assign({}, board, {revision: (board.revision || 0) + 1, updatedAt: now || new Date().toISOString()}); }
  function serialize(board){ return JSON.stringify(board, null, 2) + '\n'; }

  const api = {SCHEMA_VERSION, STATUSES, LEGACY_MAP, canonStatus, statusLabel, maskMoney, maskDeep, migrate, validateBoard, sorted, reorder, applyOrder, stepMove, nextId, decideIncoming, fingerprint, bump, serialize};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BoardModel = api;
})(typeof window !== 'undefined' ? window : this);
