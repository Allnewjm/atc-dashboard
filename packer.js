'use strict';
// Day packer: greedy pack of board tasks into today's remaining time.
// Shared by the browser (window.DayPacker) and node (require).
(function(root){
  const TZ = 'America/Chicago';
  const DEFAULT_MINUTES = 30;
  const DEFAULT_BUFFER = 0.15;
  const WORKDAY_HOURS = 8;
  const BH_START = 9, BH_END = 17;

  function partsInTz(date, tz){
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    });
    return Object.fromEntries(fmt.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  }
  // Wall-clock Y-M-D H:M in `tz` → Date (UTC instant). Corrects for DST by iteration.
  function zonedLocalToUtc(year, month, day, hour, minute, tz){
    let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
    for (let i = 0; i < 4; i++){
      const p = partsInTz(new Date(utc), tz);
      const got = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +(p.second || 0));
      const want = Date.UTC(year, month - 1, day, hour, minute, 0);
      const delta = want - got;
      if (delta === 0) break;
      utc += delta;
    }
    return new Date(utc);
  }
  function dateKey(date, tz){ const p = partsInTz(date, tz); return p.year + '-' + p.month + '-' + p.day; }
  function addMinutes(date, mins){ return new Date(date.getTime() + mins * 60000); }
  function minutesBetween(a, b){ return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000)); }
  function ceilTo5Min(date){
    const ms = 5 * 60 * 1000, t = date.getTime();
    return new Date(t % ms === 0 ? t : Math.ceil(t / ms) * ms);
  }
  function isWeekdayParts(p){ return p.weekday !== 'Sat' && p.weekday !== 'Sun'; }
  function addCalendarDays(y, m, d, n){
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
  }
  // `clock` is "HH:MM" or "H:MM" on the CT calendar day of `ref`.
  function parseClockOnDay(ref, clock, tz){
    const p = partsInTz(ref, tz);
    const m = String(clock || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return zonedLocalToUtc(+p.year, +p.month, +p.day, h, min, tz);
  }
  function fmtTime(date, tz){
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date);
  }
  function fmtRange(start, end, tz){ return fmtTime(start, tz) + '–' + fmtTime(end, tz) + ' CT'; }
  function fmtWindow(date, tz){
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(date) + ' CT';
  }

  // 1 day = 8 working hours. Missing/invalid duration → defaultMinutes and estimated=true.
  function durationMinutes(task, defaultMinutes){
    const def = defaultMinutes == null ? DEFAULT_MINUTES : defaultMinutes;
    const d = task && task.duration;
    if (!d || typeof d.value !== 'number' || !isFinite(d.value) || d.value < 0 || (d.unit !== 'hours' && d.unit !== 'days')){
      return { minutes: def, estimated: true };
    }
    const raw = d.unit === 'days' ? d.value * WORKDAY_HOURS * 60 : d.value * 60;
    return { minutes: Math.max(0, Math.round(raw)), estimated: false };
  }

  function candidates(tasks, opts){
    opts = opts || {};
    return (tasks || []).filter(t => {
      const s = t && t.status;
      if (s === 'done' || s === 'parked') return false;
      if (!opts.includeWaiting && s === 'waiting') return false;
      return true;
    });
  }

  function dueRank(deadline, todayKey){
    if (!deadline) return 2;
    if (deadline < todayKey) return 0;
    if (deadline === todayKey) return 1;
    return 2;
  }
  // Overdue, then due today, then priority −1 (top), then board sortOrder, then shorter.
  // Manual TASKS order beats ordinary numeric priority; only −1 still jumps the queue.
  function comparePackOrder(a, b, todayKey){
    const d = dueRank(a.deadline, todayKey) - dueRank(b.deadline, todayKey);
    if (d) return d;
    const ta = a.priority === -1 ? 0 : 1, tb = b.priority === -1 ? 0 : 1;
    if (ta !== tb) return ta - tb;
    const sa = (a.sortOrder == null ? 0 : a.sortOrder) - (b.sortOrder == null ? 0 : b.sortOrder);
    if (sa) return sa;
    const ma = (a.minutes == null ? 0 : a.minutes) - (b.minutes == null ? 0 : b.minutes);
    if (ma) return ma;
    return String(a.id).localeCompare(String(b.id));
  }

  // Intersection of Mon–Fri 09:00–17:00 CT on start's calendar day with [start, end].
  function businessWindow(start, end, tz){
    tz = tz || TZ;
    const p = partsInTz(start, tz);
    if (!isWeekdayParts(p)) return null;
    const winStart = zonedLocalToUtc(+p.year, +p.month, +p.day, BH_START, 0, tz);
    const winEnd = zonedLocalToUtc(+p.year, +p.month, +p.day, BH_END, 0, tz);
    const a = start.getTime() > winStart.getTime() ? start : winStart;
    const b = end.getTime() < winEnd.getTime() ? end : winEnd;
    if (a >= b) return null;
    return { start: a, end: b };
  }
  // Next time the business-hours window opens (today 9:00 if still ahead on a weekday, else next weekday 9:00).
  function nextBusinessOpen(now, tz){
    tz = tz || TZ;
    const p = partsInTz(now, tz);
    const todayNine = zonedLocalToUtc(+p.year, +p.month, +p.day, BH_START, 0, tz);
    if (isWeekdayParts(p) && todayNine.getTime() > now.getTime()) return todayNine;
    for (let i = 1; i <= 7; i++){
      const n = addCalendarDays(+p.year, +p.month, +p.day, i);
      const nine = zonedLocalToUtc(n.year, n.month, n.day, BH_START, 0, tz);
      if (isWeekdayParts(partsInTz(nine, tz))) return nine;
    }
    return todayNine;
  }

  function gaps(occupied, from, to){
    const list = occupied.filter(s => s.end > from && s.start < to).slice().sort((a, b) => a.start - b.start);
    const out = [];
    let cur = from.getTime();
    const end = to.getTime();
    for (const s of list){
      const s0 = Math.max(s.start.getTime(), from.getTime());
      if (s0 > cur) out.push({ start: new Date(cur), end: new Date(s0) });
      cur = Math.max(cur, s.end.getTime());
    }
    if (end > cur) out.push({ start: new Date(cur), end: new Date(end) });
    return out;
  }
  function findSlot(occupied, from, to, durationMin){
    if (!from || !to || to <= from) return null;
    for (const g of gaps(occupied, from, to)){
      if (minutesBetween(g.start, g.end) >= durationMin) return g.start;
    }
    return null;
  }

  // Build [start, end] from now + settings. startMode 'now' (default) or a fixed clock; hoursAvailable overrides endOfDay.
  function dayWindow(now, settings, tz){
    tz = tz || TZ;
    settings = settings || {};
    now = now instanceof Date ? now : new Date(now);
    let start;
    if (settings.startMode === 'fixed' && settings.start){
      start = parseClockOnDay(now, settings.start, tz) || ceilTo5Min(now);
    } else {
      start = ceilTo5Min(now);
    }
    let end;
    const hrs = settings.hoursAvailable;
    if (hrs !== '' && hrs != null && isFinite(Number(hrs))){
      end = addMinutes(start, Number(hrs) * 60);
    } else {
      end = parseClockOnDay(start, settings.endOfDay || '21:00', tz);
      if (!end || end <= start) end = start;
    }
    return { start, end };
  }

  function packDay(opts){
    opts = opts || {};
    const tz = opts.tz || TZ;
    const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
    const buffer = opts.buffer == null ? DEFAULT_BUFFER : Number(opts.buffer);
    const defaultMinutes = opts.defaultMinutes == null ? DEFAULT_MINUTES : opts.defaultMinutes;
    const win = (opts.start && opts.end) ? { start: new Date(opts.start), end: new Date(opts.end) } : dayWindow(now, opts.settings || { endOfDay: '21:00' }, tz);
    const start = win.start, end = win.end;
    const todayKey = dateKey(start, tz);
    const prepared = candidates(opts.tasks || [], { includeWaiting: !!opts.includeWaiting }).map(t => {
      const d = durationMinutes(t, defaultMinutes);
      return Object.assign({}, t, { minutes: d.minutes, estimated: d.estimated });
    }).sort((a, b) => comparePackOrder(a, b, todayKey));

    const capacityMin = minutesBetween(start, end);
    const packable = Math.max(0, Math.floor(capacityMin * (1 - (isFinite(buffer) ? buffer : 0))));
    const bh = businessWindow(start, end, tz);
    const occupied = [];
    const packed = [];
    const overflow = [];
    const needsBusinessHours = [];
    let used = 0;

    for (const t of prepared){
      const needBh = t.businessHours === true;
      if (needBh && !bh){ needsBusinessHours.push(t); continue; }
      const from = needBh ? bh.start : start;
      const to = needBh ? bh.end : end;
      const slot = findSlot(occupied, from, to, t.minutes);
      if (!slot){
        if (needBh) needsBusinessHours.push(t);
        else overflow.push(t);
        continue;
      }
      if (used + t.minutes > packable){ overflow.push(t); continue; }
      const item = { task: t, start: slot, end: addMinutes(slot, t.minutes), range: fmtRange(slot, addMinutes(slot, t.minutes), tz) };
      occupied.push({ start: item.start, end: item.end });
      packed.push(item);
      used += t.minutes;
    }
    packed.sort((a, b) => a.start - b.start);
    const overflowMinutes = overflow.reduce((s, t) => s + t.minutes, 0);
    const spareMinutes = packable - used;
    const verdict = overflow.length
      ? { kind: 'over', text: 'Over by ' + overflowMinutes + ' min' }
      : { kind: 'fits', text: 'Fits, ' + spareMinutes + ' min to spare' };
    const nextBh = nextBusinessOpen(start, tz);
    return {
      packed, overflow, needsBusinessHours,
      capacityMinutes: capacityMin, packableMinutes: packable, packedMinutes: used,
      spareMinutes, overflowMinutes, verdict,
      start, end, businessWindow: bh, nextBusinessOpen: nextBh,
      nextBusinessLabel: fmtWindow(nextBh, tz),
      todayKey, tz
    };
  }

  const api = {
    TZ, DEFAULT_MINUTES, DEFAULT_BUFFER, WORKDAY_HOURS,
    partsInTz, zonedLocalToUtc, dateKey, addMinutes, minutesBetween, ceilTo5Min,
    parseClockOnDay, fmtTime, fmtRange, fmtWindow,
    durationMinutes, candidates, dueRank, comparePackOrder,
    businessWindow, nextBusinessOpen, gaps, findSlot, dayWindow, packDay
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DayPacker = api;
})(typeof window !== 'undefined' ? window : this);
