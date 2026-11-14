'use strict';
// ATC Dashboard. Static, no build. Live data: board.json in this repo (see README "Board data").
const KEY = 'atc-dashboard-data-v1';
const CATS = ['Must-do/household','Legal/divorce','Money/bills','Kids','Work','Business launch','Ambitions/career'];
const MUST = new Set(['Must-do/household','Legal/divorce','Money/bills','Kids','Work']);
const DAY = 86400000;
const APP_BUILD = '2026-11-14 live board v1';
const BM = (typeof module !== 'undefined' && module.exports) ? require('./board-model.js') : window.BoardModel;
const cs = s => BM.canonStatus(s);
const ZOOM_KEY = 'atc-radar-zoom-v1';
const ZMIN = 0.5, ZMAX = 4;

// Radar view math (pure, testable). View = {z, x, y}: zoom factor and pan offset, both in % of radar size.
// A blip at offset (dx,dy) from the centre is drawn at 50 + x + dx*z, 50 + y + dy*z.
function clampView(v){
  const z = Math.min(ZMAX, Math.max(ZMIN, Number(v && v.z) || 1));
  const lim = z <= 1 ? 0 : 85*z - 40;   // no panning at or below 1x; when zoomed in, keep content in reach
  const c = n => Math.min(lim, Math.max(-lim, Number(n) || 0)) + 0;
  return {z: Math.round(z*1000)/1000, x: c(v && v.x), y: c(v && v.y)};
}
// Zoom by factor f keeping the point (cx,cy) (offset from centre, in %) fixed on screen.
function zoomAt(v, f, cx=0, cy=0){
  const z2 = Math.min(ZMAX, Math.max(ZMIN, v.z*f)); const k = z2 / v.z;
  return clampView({z: z2, x: cx - (cx - v.x)*k, y: cy - (cy - v.y)*k});
}
function blipPos(v, dx, dy){ return {left: 50 + v.x + dx*v.z, top: 50 + v.y + dy*v.z}; }

function dkey(s){ if(!s) return null; if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d=new Date(s); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function parseDay(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); }
function daysBetween(a,b){ return Math.round((parseDay(b)-parseDay(a))/DAY); }
function isActive(i){ const c=cs(i.status); return c!=='parked' && c!=='done'; }
function boardItems(items, showParked){ return (items||[]).filter(i=>cs(i.status)!=='done' && (showParked || cs(i.status)!=='parked')); }
// Canonical board -> the item list the views use (not-done tasks, due = deadline).
function viewData(board){ return Object.assign({}, board, {items: BM.sorted(board.tasks||[]).filter(t=>t.status!=='done').map(t=>Object.assign({}, t, {due: t.deadline||null}))}); }
function validate(d){ const b=BM.migrate(d); b.events=b.events||[]; b.goals=b.goals||{}; return b; }
function words(s){ return (s||'').toLowerCase().match(/[a-záéíóúñ]{5,}/g)||[]; }

function detectConflicts(data){
  const today = dkey(new Date().toISOString()) ;
  const T = data.todayOverride || today;
  const out = [];
  const items = data.items||[], events = (data.events||[]).filter(e=>e.start);
  const active = items.filter(isActive);
  // 1 overdue
  active.filter(i=>i.due && i.due < T).forEach(i=>{
    const late = daysBetween(i.due,T);
    out.push({sev: i.priority<=1 ? 3 : 2, type:'OVERDUE', title:`${i.id} ${i.title}`, detail:`Due ${i.due}, ${late} day(s) late. Status ${BM.statusLabel(i)}.`, day:i.due, refs:[i.id]});
  });
  // 2 deadline clusters
  const byDay = {};
  active.filter(i=>i.due && i.due>=T).forEach(i=>(byDay[i.due]=byDay[i.due]||[]).push(i));
  Object.entries(byDay).forEach(([k,arr])=>{ if(arr.length>=2) out.push({sev:2,type:'DEADLINE STACK',title:`${arr.length} deadlines on ${k}`,detail:arr.map(i=>i.id+' '+i.title).join(' · '),day:k,refs:arr.map(i=>i.id)}); });
  // 3 overlapping events
  const timed = events.filter(e=>!e.allDay && e.end && (new Date(e.end)-new Date(e.start))<12*3.6e6).map(e=>({...e,s:+new Date(e.start),e2:+new Date(e.end)})).sort((a,b)=>a.s-b.s);
  for(let a=0;a<timed.length;a++) for(let b=a+1;b<timed.length && timed[b].s<timed[a].e2;b++)
    if(dkey(timed[a].start)>=T) out.push({sev:3,type:'OVERLAP',title:`${timed[a].title} ✕ ${timed[b].title}`,detail:`${fmtT(timed[a].start)} to ${fmtT(timed[a].end)} overlaps ${fmtT(timed[b].start)} to ${fmtT(timed[b].end)}`,day:dkey(timed[a].start),refs:[timed[a].id,timed[b].id]});
  // 4 deadlines with no time block before them
  const blocks = events.filter(e=>e.block);
  active.filter(i=>i.due && i.due>=T && daysBetween(T,i.due)<=21 && (i.priority??4)<=2).forEach(i=>{
    const w = new Set(words(i.title));
    const has = blocks.some(b=>dkey(b.start)>=T && dkey(b.start)<=i.due && words(b.title).some(x=>w.has(x)));
    if(!has) out.push({sev:1,type:'NO TIME BLOCK',title:`${i.id} ${i.title}`,detail:`Due ${i.due} with no work block on the calendar before it.`,day:i.due,refs:[i.id]});
  });
  // 5 overloaded days (next 42 days)
  for(let n=0;n<42;n++){ const dd=new Date(parseDay(T).getTime()+n*DAY); const k=dkey(dd.toISOString());
    const evs=events.filter(e=>dkey(e.start)===k && !/basura/i.test(e.title)); const dls=active.filter(i=>i.due===k);
    const hrs=evs.filter(e=>!e.allDay&&e.end).reduce((s,e)=>s+(new Date(e.end)-new Date(e.start))/3.6e6,0);
    if(evs.length+dls.length>=4 || hrs>=4) out.push({sev:2,type:'OVERLOAD',title:`Heavy day ${k}`,detail:`${evs.length} event(s), ${dls.length} deadline(s), ${hrs.toFixed(1)} h booked`,day:k,refs:[]});
  }
  // 6 too many NOW items (Goal Coach: cap NOW at 3)
  const now = active.filter(i=>cs(i.status)==='in-progress');
  if(now.length>3) out.push({sev:2,type:'WIP',title:`${now.length} items marked NOW (cap is 3)`,detail:'Theory of Constraints: too much work in progress. Park or close some.',day:T,refs:now.map(i=>i.id)});
  return out.sort((a,b)=>b.sev-a.sev || (a.day||'').localeCompare(b.day||''));
}
function fmtT(s){ const d=new Date(s); return d.toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function fmtD(k){ if(!k) return 'no date'; return parseDay(k).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}); }

if (typeof module !== 'undefined') module.exports = {detectConflicts, boardItems, validate, viewData, isActive, clampView, zoomAt, blipPos, ZMIN, ZMAX};

if (typeof document !== 'undefined') {
  const $ = s => document.querySelector(s);
  const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // ---- Live board config ----
  const REPO = 'Allnewjm/atc-dashboard', BRANCH = 'main', FILE = 'board.json';
  const API_URL = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
  const RAW_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${FILE}`;
  const TOKEN_KEY = 'atc-gh-token-v1', CACHE_KEY = 'atc-board-cache-v1';
  const POLL_MS = 5000;
  const tok = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch(e){ return ''; } };

  let BOARD = null;        // canonical board currently shown (may include unsaved optimistic edits)
  let CONFIRMED = null;    // last board known to be on GitHub
  let SHA = null, ETAG = null, FP = null;  // content sha (API), ETag (API), fingerprint (raw)
  let SOURCE = 'none';     // live | cached | import | demo
  let LAST_SYNC = 0, SYNC_ERR = '', BACKOFF = 0;
  let PENDING = [];        // mutation fns not yet confirmed on GitHub
  let WRITING = false, DEFER_RENDER = false;
  let DATA, CONF;

  function setBoard(b, source){ BOARD = b; SOURCE = source; DATA = viewData(b); DATA._mine = source !== 'demo'; }
  function b64e(s){ const u = new TextEncoder().encode(s); let bin=''; for (let i=0;i<u.length;i+=0x8000) bin += String.fromCharCode.apply(null, u.subarray(i,i+0x8000)); return btoa(bin); }
  function b64d(s){ const bin = atob(s.replace(/\n/g,'')); const u = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return new TextDecoder().decode(u); }
  const authH = () => ({'Authorization': 'Bearer ' + tok(), 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'});

  // Fetch board.json. With a token: contents API + If-None-Match (304s are free; 5,000/hr limit).
  // Without: raw.githubusercontent.com with a cache-busting query (no API rate limit).
  // Returns {changed:false} or {changed:true, board, sha}.
  async function fetchLive(force, pub){
    if (tok() && !pub) {
      const h = authH(); if (ETAG && !force) h['If-None-Match'] = ETAG;
      const r = await fetch(API_URL + '?ref=' + BRANCH + '&_=' + Date.now(), {headers: h, cache: 'no-store'});
      if (r.status === 304) return {changed: false};
      if (r.status === 401) throw Object.assign(new Error('token rejected (401). Check it in ⚙ Sync.'), {auth: true});
      if (r.status === 403 || r.status === 429) { const rem = r.headers.get('x-ratelimit-remaining'); throw Object.assign(new Error(rem === '0' ? 'GitHub rate limit hit, slowing down' : 'token lacks access to ' + REPO + ' (' + r.status + ')'), {auth: rem !== '0', rate: rem === '0'}); }
      if (!r.ok) throw new Error('GitHub API ' + r.status);
      ETAG = r.headers.get('ETag');
      const j = await r.json();
      return {changed: true, board: BM.migrate(JSON.parse(b64d(j.content))), sha: j.sha};
    }
    const r = await fetch(RAW_URL + '?t=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) throw new Error('board.json ' + r.status);
    const txt = await r.text(); const fp = BM.fingerprint(txt);
    if (fp === FP && !force) return {changed: false};
    FP = fp;
    return {changed: true, board: BM.migrate(JSON.parse(txt)), sha: null};
  }
  function busy(){ const a = document.activeElement; return DEFER_RENDER || DRAGID || (a && a.closest && a.closest('#tasks') && /INPUT|SELECT|TEXTAREA/.test(a.tagName)); }
  async function poll(force){
    if (SOURCE === 'import') return;
    try {
      let res, fellBack = '';
      try { res = await fetchLive(force); }
      catch (err) { if (!err.auth) throw err; res = await fetchLive(true, true); fellBack = err.message + ' Reading public copy.'; }
      LAST_SYNC = Date.now(); BACKOFF = 0;
      SYNC_ERR = fellBack;
      if (res.changed) {
        const d = BM.decideIncoming(BOARD && SOURCE === 'live' ? BOARD : null, res.board);
        if (!PENDING.length) { CONFIRMED = res.board; if (res.sha) SHA = res.sha; }
        if (d === 'apply' || (SOURCE !== 'live' && !PENDING.length)) {
          setBoard(res.board, 'live');
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(res.board)); } catch(e){}
          if (busy()) DEFER_RENDER = true; else render();
        }
      }
    } catch (err) {
      SYNC_ERR = err.message; if (err.rate) BACKOFF = 60000;
      if (err.auth && SOURCE !== 'live') { /* fall back to public read next round */ }
      if (!BOARD) startOffline();
    }
    syncLabel();
  }
  let TIMER = null;
  function schedule(){ clearTimeout(TIMER); TIMER = setTimeout(async () => { if (!document.hidden) await poll(); if (DEFER_RENDER && !busy()) { DEFER_RENDER = false; render(); } schedule(); }, POLL_MS + BACKOFF); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  function startOffline(){
    try { const c = localStorage.getItem(CACHE_KEY); if (c) { setBoard(BM.migrate(JSON.parse(c)), 'cached'); render(); return; } } catch(e){}
    try { const raw = localStorage.getItem(KEY); if (raw) { setBoard(validate(JSON.parse(raw)), 'import'); render(); return; } } catch(e){}
    setBoard(validate(window.SAMPLE_DATA), 'demo'); render();
  }

  // ---- Writes: optimistic, then PUT to the contents API with the current sha ----
  function flash(msg, bad){ const m = $('#msg'); m.innerHTML = `<span class="${bad?'red':'ok'}">${esc(msg)}</span>`; clearTimeout(flash.t); flash.t = setTimeout(()=>{ m.textContent=''; }, bad ? 12000 : 4000); }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function mutate(fn, label){
    if (SOURCE !== 'live') return flash('Editing needs the live board (now showing ' + SOURCE + ' data).', true);
    if (!tok()) { flash('To edit, add a GitHub token in ⚙ Sync (read-only without one).', true); $('#sync-dlg').showModal(); return; }
    const next = BM.bump(fn(clone(BOARD)));
    PENDING.push({fn, label});
    setBoard(next, 'live'); render();
    flush();
  }
  async function getSha(){ const r = await fetch(API_URL + '?ref=' + BRANCH + '&_=' + Date.now(), {headers: authH(), cache: 'no-store'}); if (!r.ok) throw new Error('read for sha failed ' + r.status); const j = await r.json(); return {sha: j.sha, board: BM.migrate(JSON.parse(b64d(j.content)))}; }
  async function flush(){
    if (WRITING) return; WRITING = true; let tries = 0;
    try {
      while (PENDING.length) {
        if (!SHA) { const s = await getSha(); SHA = s.sha; CONFIRMED = s.board; if (BM.decideIncoming(CONFIRMED, BOARD) !== 'apply') rebase(); }
        const n = PENDING.length, snap = BOARD;
        const r = await fetch(API_URL, {method: 'PUT', headers: Object.assign({'Content-Type': 'application/json'}, authH()),
          body: JSON.stringify({message: 'Board: ' + PENDING.slice(0, n).map(p => p.label).join('; ') + ' (dashboard)', content: b64e(BM.serialize(snap)), sha: SHA, branch: BRANCH})});
        if (r.ok) { const j = await r.json(); SHA = j.content.sha; ETAG = null; CONFIRMED = snap; PENDING.splice(0, n); LAST_SYNC = Date.now(); tries = 0; flash('Saved: ' + (n > 1 ? n + ' changes' : 'change') + ' (rev ' + snap.revision + ')'); try { localStorage.setItem(CACHE_KEY, JSON.stringify(snap)); } catch(e){} continue; }
        if ((r.status === 409 || r.status === 422) && ++tries <= 2) { const s = await getSha(); SHA = s.sha; CONFIRMED = s.board; rebase(); flash('Board changed elsewhere; re-applied your edit on the latest version.'); continue; }
        throw new Error('save failed (' + r.status + (r.status === 403 || r.status === 404 ? ', token needs Contents: read and write on ' + REPO : '') + ')');
      }
    } catch (err) {
      PENDING = []; if (CONFIRMED) setBoard(CONFIRMED, 'live'); render();
      flash('Not saved, change rolled back: ' + err.message, true);
      SHA = null; ETAG = null; poll(true);
    } finally { WRITING = false; syncLabel(); }
  }
  // Re-apply pending edits on top of the latest confirmed board.
  function rebase(){ let b = CONFIRMED; for (const p of PENDING) b = BM.bump(p.fn(clone(b))); setBoard(b, 'live'); render(); }

  // ---- Sync indicator ----
  const ctFmt = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'});
  function syncLabel(){
    const el = $('#sync'); if (!el) return;
    const up = BOARD && BOARD.updatedAt ? ctFmt.format(new Date(BOARD.updatedAt)) + ' CT' : 'n/a';
    const ago = LAST_SYNC ? Math.max(0, Math.round((Date.now() - LAST_SYNC) / 1000)) + 's ago' : 'not yet';
    const mode = SOURCE === 'live' ? (tok() ? 'live · token (edits on)' : 'live · public (read-only)') : SOURCE === 'cached' ? 'offline copy' : SOURCE === 'import' ? 'imported file (live paused)' : SOURCE;
    el.innerHTML = `<span class="${SOURCE==='live' && !SYNC_ERR ? 'ok' : 'warn'}">● ${esc(mode)}</span> · Last updated ${esc(up)} · synced ${esc(ago)}${BOARD && BOARD.revision ? ' · rev ' + BOARD.revision : ''}${PENDING.length ? ' · <span class="warn">saving…</span>' : ''}${SYNC_ERR ? ` · <span class="red">${esc(SYNC_ERR)}</span>` : ''}`;
  }
  setInterval(syncLabel, 1000);

  let SHOW_PARKED = false, SHOW_DONE = false;
  function render(){
    CONF = detectConflicts(DATA);
    const all = BOARD && BOARD.tasks ? BOARD.tasks : [];
    const done = all.filter(t => t.status === 'done').length;
    $('#src').innerHTML = DATA._mine ? `<span class="ok">● YOUR DATA</span> ${esc(DATA.label||'')} · ${(DATA.items||[]).length} open, ${done} done, ${(DATA.events||[]).length} events · app ${APP_BUILD}` : `<span class="warn">● DEMO DATA</span> fictional sample (live board unavailable). · app ${APP_BUILD}`;
    $('#alerts').innerHTML = CONF.length ? CONF.slice(0,12).map((c,i)=>`<button class="alert s${c.sev}" data-c="${i}"><b>${c.type}</b> ${esc(c.title)}</button>`).join('') : '<span class="ok">No conflicts detected. Skies clear.</span>';
    $('#ccount').textContent = CONF.length;
    renderScope(); renderTimeline(); renderBoard(); renderTasks(); renderGoals(); syncLabel();
  }
  const flagged = id => CONF.filter(c=>c.refs.includes(id));
  function chip(i){
    const f=flagged(i.id); const T=dkey(new Date().toISOString());
    const od = i.due && i.due<T && isActive(i);
    return `<div class="item p${i.priority??4} ${f.length?'hot':''}" data-i="${esc(i.id)}">
      <div class="row"><span class="id">${esc(i.id)}</span><span class="st">${esc(BM.statusLabel(i))}</span>${MUST.has(i.category)?'':'<span class="amb">AMBITION</span>'}</div>
      <div class="ttl">${esc(i.title)}</div>
      <div class="row small"><span class="${od?'red':''}">${i.due?'⏱ '+fmtD(i.due):'no date'}${i.duration?' · '+esc(i.duration.value+' '+i.duration.unit):''}</span><span>${esc(i.category)}</span>${f.length?`<span class="red">⚠ ${f.length}</span>`:''}</div></div>`;
  }
  function renderScope(){
    const T=dkey(new Date().toISOString()); const wk=dkey(new Date(Date.now()+7*DAY).toISOString());
    const act=(DATA.items||[]).filter(isActive);
    const score=i=>(i.priority??4)*100 + (i.due? Math.max(-50,Math.min(60,daysBetween(T,i.due))) : 80);
    const now=act.filter(i=>(i.priority??4)<=2 || (i.due&&i.due<=wk)).sort((a,b)=>score(a)-score(b));
    const rest=act.filter(i=>!now.includes(i)).sort((a,b)=>score(a)-score(b));
    const evs=(DATA.events||[]).filter(e=>dkey(e.start)>=T && dkey(e.start)<=wk).sort((a,b)=>a.start.localeCompare(b.start));
    $('#scope').innerHTML = `<div class="radar-wrap"><div class="radar" id="radar"><div class="rings"></div><div class="sweep"></div>${now.slice(0,14).map((i,n)=>{const a=n*2.39, r=18+ (Math.min(i.priority??4,4))*16; return `<span class="blip p${i.priority??4}" data-i="${esc(i.id)}" data-dx="${(r*Math.cos(a)).toFixed(3)}" data-dy="${(r*Math.sin(a)).toFixed(3)}" style="left:${50+r*Math.cos(a)}%;top:${50+r*Math.sin(a)}%" title="${esc(i.title)}">${esc(i.id)}</span>`}).join('')}</div>
      <div class="zoomctl" aria-label="Radar zoom"><button type="button" id="zIn" title="Zoom in">+</button><button type="button" id="zOut" title="Zoom out">−</button><button type="button" id="zReset" title="Reset zoom and recenter">⟲</button></div><div class="zlevel" id="zLevel">1.0×</div></div>
      <div class="cols2"><section><h3>ON RADAR · now / this week (${now.length})</h3>${now.map(chip).join('')}</section>
      <section><h3>NEXT 7 DAYS · calendar</h3>${evs.map(e=>`<div class="ev" data-e="${esc(e.id)}"><b>${e.allDay?fmtD(dkey(e.start)):fmtT(e.start)}</b> ${esc(e.title)}</div>`).join('')||'<i>nothing booked</i>'}
      <h3>HOLDING PATTERN (${rest.length})</h3>${rest.map(chip).join('')}</section></div>`;
    applyView();
  }
  // ---- Radar zoom / pan ----
  let VIEW = {z:1,x:0,y:0};
  try { VIEW = clampView(JSON.parse(localStorage.getItem(ZOOM_KEY)||'null')||VIEW); } catch(e){}
  function applyView(){
    const r=$('#radar'); if(!r) return;
    r.querySelectorAll('.blip').forEach(b=>{ const p=blipPos(VIEW, +b.dataset.dx, +b.dataset.dy); b.style.left=p.left+'%'; b.style.top=p.top+'%'; });
    const g=r.querySelector('.rings'); if(g) g.style.transform=`translate(${VIEW.x}%,${VIEW.y}%) scale(${VIEW.z})`;
    r.classList.toggle('pannable', VIEW.z>1);
    const l=$('#zLevel'); if(l) l.textContent=VIEW.z.toFixed(1)+'×';
    const zi=$('#zIn'), zo=$('#zOut'); if(zi) zi.disabled=VIEW.z>=ZMAX; if(zo) zo.disabled=VIEW.z<=ZMIN;
  }
  function setView(v){ VIEW=clampView(v); try{ localStorage.setItem(ZOOM_KEY, JSON.stringify(VIEW)); }catch(e){} applyView(); }
  // pointer position relative to radar centre, in % of radar size
  function rel(r, cx, cy){ const b=r.getBoundingClientRect(); return [((cx-b.left)/b.width-0.5)*100, ((cy-b.top)/b.height-0.5)*100]; }
  const PTRS = new Map(); let DRAG=null, PINCH=null, SUPPRESS=false;
  document.addEventListener('wheel', e=>{ const r=e.target.closest && e.target.closest('#radar'); if(!r) return; e.preventDefault();
    const [cx,cy]=rel(r,e.clientX,e.clientY); setView(zoomAt(VIEW, Math.exp(-e.deltaY*0.0015), cx, cy)); }, {passive:false});
  document.addEventListener('pointerdown', e=>{ const r=e.target.closest && e.target.closest('#radar'); if(!r) return;
    PTRS.set(e.pointerId,{x:e.clientX,y:e.clientY}); SUPPRESS=false;
    if(PTRS.size===2){ const [a,b]=[...PTRS.values()]; const [cx,cy]=rel(r,(a.x+b.x)/2,(a.y+b.y)/2); PINCH={d:Math.hypot(a.x-b.x,a.y-b.y)||1, v:{...VIEW}, cx, cy}; DRAG=null; }
    else if(PTRS.size===1){ DRAG={sx:e.clientX, sy:e.clientY, v:{...VIEW}, moved:false}; }
  });
  document.addEventListener('pointermove', e=>{ if(!PTRS.has(e.pointerId)) return; PTRS.set(e.pointerId,{x:e.clientX,y:e.clientY}); const r=$('#radar'); if(!r) return;
    if(PINCH && PTRS.size>=2){ const [a,b]=[...PTRS.values()]; SUPPRESS=true; setView(zoomAt(PINCH.v, Math.hypot(a.x-b.x,a.y-b.y)/PINCH.d, PINCH.cx, PINCH.cy)); return; }
    if(DRAG){ const dx=e.clientX-DRAG.sx, dy=e.clientY-DRAG.sy; if(!DRAG.moved && Math.hypot(dx,dy)<5) return; DRAG.moved=true; SUPPRESS=true;
      if(DRAG.v.z>1){ const b=r.getBoundingClientRect(); setView({z:DRAG.v.z, x:DRAG.v.x+dx/b.width*100, y:DRAG.v.y+dy/b.height*100}); } }
  });
  const endPtr = e=>{ PTRS.delete(e.pointerId); if(PTRS.size<2) PINCH=null; if(!PTRS.size) DRAG=null; };
  document.addEventListener('pointerup', endPtr); document.addEventListener('pointercancel', endPtr);
  // a drag or pinch should not also open the item under the finger
  document.addEventListener('click', e=>{ if(SUPPRESS && e.target.closest && e.target.closest('#radar')){ e.stopPropagation(); e.preventDefault(); } SUPPRESS=false; }, true);
  document.addEventListener('click', e=>{ const id=e.target.id; if(id==='zIn') setView(zoomAt(VIEW,1.25)); else if(id==='zOut') setView(zoomAt(VIEW,0.8)); else if(id==='zReset') setView({z:1,x:0,y:0}); });
  function renderTimeline(){
    const T=dkey(new Date().toISOString()); let h='';
    for(let n=0;n<42;n++){ const k=dkey(new Date(parseDay(T).getTime()+n*DAY+3600000*12).toISOString());
      const evs=(DATA.events||[]).filter(e=>dkey(e.start)===k).sort((a,b)=>a.start.localeCompare(b.start));
      const dls=(DATA.items||[]).filter(i=>isActive(i)&&i.due===k);
      const ms=((DATA.goals||{}).milestones||[]).filter(m=>m.date===k);
      const cf=CONF.filter(c=>c.day===k);
      if(!evs.length&&!dls.length&&!ms.length&&n%7) continue;
      const wkend=[0,6].includes(parseDay(k).getDay());
      h+=`<div class="day ${cf.length?'cday':''} ${wkend?'wkend':''}"><div class="dlabel">${fmtD(k)}${cf.length?` <span class="red">⚠ ${cf.map(c=>c.type).join(', ')}</span>`:''}</div>
        ${evs.map(e=>`<div class="ev ${e.block?'blk':''}" data-e="${esc(e.id)}"><b>${e.allDay?'all day':new Date(e.start).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</b> ${esc(e.title)}</div>`).join('')}
        ${dls.map(i=>`<div class="dl" data-i="${esc(i.id)}">◆ DEADLINE ${esc(i.id)} ${esc(i.title)}</div>`).join('')}
        ${ms.map(m=>`<div class="ms">★ MILESTONE ${esc(m.title)}</div>`).join('')}</div>`; }
    const T0=(DATA.items||[]).filter(i=>isActive(i)&&i.due&&i.due<T);
    $('#timeline').innerHTML = (T0.length?`<div class="day cday"><div class="dlabel red">BEHIND YOU · overdue (${T0.length})</div>${T0.map(i=>`<div class="dl" data-i="${esc(i.id)}">◆ ${esc(i.id)} ${esc(i.title)} <span class="red">(${fmtD(i.due)})</span></div>`).join('')}</div>`:'') + h;
  }
  function renderBoard(){
    const act=boardItems(DATA.items, SHOW_PARKED);
    const parked=(DATA.items||[]).filter(i=>cs(i.status)==='parked').length;
    const cats=[...CATS, ...new Set(act.map(i=>i.category).filter(c=>!CATS.includes(c)))];
    $('#board').innerHTML = `<p class="small"><label><input type="checkbox" id="showParked" ${SHOW_PARKED?'checked':''}> Show parked (${parked})</label> · columns follow the TASKS order</p><div class="kan">${cats.map(c=>{const a=BM.sorted(act.filter(i=>i.category===c)); return `<div class="col ${MUST.has(c)?'must':'ambc'}"><h3>${esc(c)} <small>${a.length}</small></h3><div class="tag">${MUST.has(c)?'MUST-DO':'AMBITION'}</div>${a.map(chip).join('')}</div>`}).join('')}</div>`;
  }
  // ---- TASKS: the editing view ----
  function renderTasks(){
    const all = BM.sorted((BOARD && BOARD.tasks) || []); const list = all.filter(t => SHOW_DONE || t.status !== 'done');
    const canEdit = SOURCE === 'live' && !!tok();
    const opt = t => BM.STATUSES.map(s => `<option value="${s}" ${t.status===s?'selected':''}>${s}</option>`).join('');
    $('#tasks').innerHTML = `<p class="small">${canEdit ? 'Edits save to board.json on GitHub right away.' : SOURCE === 'live' ? '<span class="warn">Read-only.</span> Add a GitHub token in <a href="#" data-act="sync">⚙ Sync</a> to edit.' : '<span class="warn">Read-only: not showing the live board.</span>'} Drag ⠿ or use ▲▼ to reorder. <label><input type="checkbox" id="showDone" ${SHOW_DONE?'checked':''}> Show done (${all.length - all.filter(t=>t.status!=='done').length})</label></p>
      <form id="addTask" class="addrow"><input name="title" placeholder="New task title" required ${canEdit?'':'disabled'}><input name="deadline" type="date" title="Deadline" ${canEdit?'':'disabled'}><input name="dv" type="number" min="0" step="0.25" placeholder="dur" title="Duration" ${canEdit?'':'disabled'}><select name="du" ${canEdit?'':'disabled'}><option>hours</option><option>days</option></select><button ${canEdit?'':'disabled'}>Add</button></form>
      <div class="tlist">${list.map(t => `<div class="trow ${t.status==='done'?'isdone':''}" data-tid="${esc(t.id)}">
        <span class="grip" draggable="${canEdit}" title="Drag to reorder">⠿</span><span class="mv"><button data-act="up" ${canEdit?'':'disabled'} title="Move up">▲</button><button data-act="down" ${canEdit?'':'disabled'} title="Move down">▼</button></span>
        <input type="checkbox" data-act="done" ${t.status==='done'?'checked':''} ${canEdit?'':'disabled'} title="Done">
        <span class="id" data-i="${esc(t.id)}">${esc(t.id)}</span><span class="tt" data-i="${esc(t.id)}">${esc(t.title)}</span>
        <select data-act="status" ${canEdit?'':'disabled'}>${opt(t)}</select>
        <input type="date" data-act="deadline" value="${esc(t.deadline||'')}" ${canEdit?'':'disabled'} title="Deadline">
        <input type="number" data-act="dv" min="0" step="0.25" value="${t.duration?esc(t.duration.value):''}" placeholder="dur" ${canEdit?'':'disabled'} title="Duration"><select data-act="du" ${canEdit?'':'disabled'}><option ${t.duration&&t.duration.unit==='hours'?'selected':''}>hours</option><option ${t.duration&&t.duration.unit==='days'?'selected':''}>days</option></select>
      </div>`).join('')}</div>`;
  }
  const findT = (b, id) => b.tasks.find(t => t.id === id);
  function setStatus(id, st){ mutate(b => { const t = findT(b, id); t.status = st; delete t.legacyStatus; if (st === 'done') t.completed = t.completed || dkey(new Date().toISOString()); return b; }, `${id} status → ${st}`); }
  function move(id, beforeId){ mutate(b => { b.tasks = BM.applyOrder(b.tasks, BM.reorder(b.tasks, id, beforeId)); return b; }, `reorder ${id}`); }
  function visibleTasks(){ return BM.sorted(BOARD.tasks).filter(t => SHOW_DONE || t.status !== 'done'); }
  let DRAGID = null;
  document.addEventListener('dragstart', e => { const g = e.target.closest && e.target.closest('.grip'); if (!g) return; DRAGID = g.closest('.trow').dataset.tid; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', DRAGID); g.closest('.trow').classList.add('dragging'); });
  document.addEventListener('dragover', e => { const r = e.target.closest && e.target.closest('.trow'); if (!r || !DRAGID) return; e.preventDefault(); document.querySelectorAll('.trow.over-top,.trow.over-bot').forEach(x => x.classList.remove('over-top','over-bot')); const b = r.getBoundingClientRect(); r.classList.add(e.clientY < b.top + b.height/2 ? 'over-top' : 'over-bot'); });
  document.addEventListener('drop', e => { const r = e.target.closest && e.target.closest('.trow'); if (!r || !DRAGID) return; e.preventDefault();
    const id = DRAGID, top = r.classList.contains('over-top'); const vis = visibleTasks(); const k = vis.findIndex(t => t.id === r.dataset.tid);
    let before = top ? r.dataset.tid : (vis[k+1] ? vis[k+1].id : null); if (before === id) before = vis[k+1] ? vis[k+1].id : null;
    DRAGID = null; if (r.dataset.tid !== id) move(id, before); });
  document.addEventListener('dragend', () => { DRAGID = null; document.querySelectorAll('.dragging,.over-top,.over-bot').forEach(x => x.classList.remove('dragging','over-top','over-bot')); if (DEFER_RENDER) { DEFER_RENDER = false; render(); } });
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act; if (act === 'sync') { e.preventDefault(); return openSync(); }
    const row = b.closest('.trow'); if (!row) return; const id = row.dataset.tid;
    if (act === 'up' || act === 'down') { const vis = visibleTasks(), k = vis.findIndex(t => t.id === id), dir = act === 'up' ? -1 : 1;
      if (k + dir >= 0 && k + dir < vis.length) move(id, BM.stepMove(vis, id, dir)); }
  });
  document.addEventListener('change', e => { const el = e.target; const row = el.closest && el.closest('.trow'); if (!row) return; const id = row.dataset.tid, act = el.dataset.act;
    if (act === 'done') return setStatus(id, el.checked ? 'done' : 'open');
    if (act === 'status') return setStatus(id, el.value);
    if (act === 'deadline') return mutate(b => { findT(b, id).deadline = el.value || null; return b; }, `${id} deadline → ${el.value || 'none'}`);
    if (act === 'dv' || act === 'du') { const v = row.querySelector('[data-act=dv]').value, u = row.querySelector('[data-act=du]').value;
      return mutate(b => { findT(b, id).duration = v === '' ? null : {value: Math.max(0, Number(v)), unit: u}; return b; }, `${id} duration → ${v === '' ? 'none' : v + ' ' + u}`); }
  });
  document.addEventListener('submit', e => { if (e.target.id !== 'addTask') return; e.preventDefault(); const f = e.target;
    const title = BM.maskMoney(f.title.value.trim()); if (!title) return; const dl = f.deadline.value || null, dv = f.dv.value, du = f.du.value;
    mutate(b => { const id = BM.nextId(b.tasks); const open = b.tasks.filter(t => t.status !== 'done');
      b.tasks.push({id, title, status: 'open', duration: dv === '' ? null : {value: Number(dv), unit: du}, deadline: dl, sortOrder: (open.length ? Math.min(...open.map(t => t.sortOrder)) : 20) - 10,
        notes: 'Added ' + ctFmt.format(new Date()) + ' CT on the dashboard.', owner: 'Julian', priority: 2, category: 'Must-do/household', section: 'NOW', court: 'mine'}); return b; }, `add "${title}"`);
  });
  function renderGoals(){
    const g=DATA.goals||{};
    $('#goals').innerHTML = `<h3>GOAL</h3><p>${esc(g.statement||'')}</p><h3>CONSTRAINT (the bottleneck)</h3><p>${esc(g.constraint||'')}</p>
      ${(g.hypotheses||[]).map(x=>`<div class="hyp"><b>${esc(x.id)}</b> ${esc(x.text)}</div>`).join('')}
      <h3>MILESTONES</h3>${(g.milestones||[]).map(m=>`<div class="ev"><b>${fmtD(m.date)}</b> ${esc(m.title)} <small>${esc(m.measure)}</small></div>`).join('')}<p class="small">${esc(g.source||'')}</p>`;
  }
  function show(html){ $('#dlg-body').innerHTML=html; $('#dlg').showModal(); }
  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-i],[data-e],[data-c],[data-tab]'); if(!t) return;
    if(t.dataset.tab){ document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('on',b===t)); document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==t.dataset.tab); return; }
    if(t.dataset.c!==undefined){ const c=CONF[+t.dataset.c]; return show(`<h2 class="s${c.sev}">${c.type}</h2><p><b>${esc(c.title)}</b></p><p>${esc(c.detail)}</p>`); }
    if(t.dataset.i){ const i=(BOARD.tasks||[]).find(x=>x.id===t.dataset.i); if(!i) return; const f=CONF?flagged(i.id):[];
      return show(`<h2>${esc(i.id)} ${esc(i.title)}</h2><p><b>Status</b> ${esc(BM.statusLabel(i))} · <b>Owner</b> ${esc(i.owner)} · <b>Category</b> ${esc(i.category)}</p><p><b>Deadline</b> ${i.deadline?fmtD(i.deadline):'none'} · <b>Duration</b> ${i.duration?esc(i.duration.value+' '+i.duration.unit):'none'}</p><p>${esc(i.notes)}</p>${f.map(c=>`<p class="red">⚠ ${c.type}: ${esc(c.detail)}</p>`).join('')}`); }
    if(t.dataset.e){ const ev=DATA.events.find(x=>x.id===t.dataset.e); if(!ev) return;
      return show(`<h2>${esc(ev.title)}</h2><p>${ev.allDay?fmtD(dkey(ev.start))+' (all day)':fmtT(ev.start)+' to '+fmtT(ev.end)}</p><p>${esc(ev.category)}${ev.block?' · time block':''}</p>`); }
  });
  document.addEventListener('change',e=>{ if(e.target.id==='showParked'){ SHOW_PARKED=e.target.checked; renderBoard(); } if(e.target.id==='showDone'){ SHOW_DONE=e.target.checked; renderTasks(); } });
  // Manual import stays as a fallback: shows that file in this browser and pauses live sync until reload / "Back to live".
  function importText(txt){ $('#impErr').textContent=''; try{ const d=validate(JSON.parse(txt)); localStorage.setItem(KEY,JSON.stringify(d)); setBoard(d,'import'); PENDING=[]; render(); $('#imp').close(); $('#msg').innerHTML=esc('Imported '+DATA.items.length+' open items, '+(d.events||[]).length+' events (this browser only; live sync paused). ')+'<a href="#" id="backLive">Back to live board</a>'; return true; } catch(err){ $('#impErr').textContent='Import failed: '+err.message+' (previous data kept)'; return false; } }
  window.atcImport = importText;
  // ---- Sync settings (token) ----
  function openSync(){ $('#tokIn').value=''; $('#tokState').textContent = tok() ? 'A token is saved in this browser (edits enabled).' : 'No token saved: the board is live but read-only.'; $('#sync-dlg').showModal(); }
  async function saveToken(){ const v=$('#tokIn').value.trim(); if(!v) return; const old=tok(); localStorage.setItem(TOKEN_KEY, v); $('#tokState').textContent='Checking…';
    try { const r = await fetch(`https://api.github.com/repos/${REPO}`, {headers: authH(), cache:'no-store'}); const j = r.ok ? await r.json() : null;
      if (!r.ok) throw new Error('GitHub said ' + r.status); if (j.permissions && !j.permissions.push) throw new Error('token can read but not write. Set Contents: Read and write.');
      $('#tokState').innerHTML='<span class="ok">Saved. Edits enabled.</span>'; ETAG=null; SHA=null; await poll(true); render();
    } catch(err){ if(old) localStorage.setItem(TOKEN_KEY, old); else localStorage.removeItem(TOKEN_KEY); $('#tokState').innerHTML='<span class="red">Not saved: '+esc(err.message)+'</span>'; } }
  window.addEventListener('DOMContentLoaded',()=>{
    $('#btnImport').onclick=()=>{ window.open('https://drive.google.com/drive/folders/1BaAZetxcpYbTf5wqi_f0DPSRUww-Gs9n','_blank','noopener'); $('#impErr').textContent=''; $('#file').value=''; $('#imp').showModal(); };
    $('#file').onchange=e=>{ const inp=e.target, f=inp.files[0]; if(!f) return; f.text().then(importText, err=>{ $('#impErr').textContent='Import failed: '+err.message; }).finally(()=>{ inp.value=''; }); };
    $('#doPaste').onclick=()=>importText($('#paste').value);
    $('#btnClear').onclick=()=>{ if(confirm('Remove imported data and the offline copy from this browser? (The live board is not touched.)')){ localStorage.removeItem(KEY); localStorage.removeItem(CACHE_KEY); SOURCE='none'; BOARD=null; FP=null; ETAG=null; poll(true); } };
    $('#btnSync').onclick=openSync; $('#tokSave').onclick=saveToken;
    $('#tokDel').onclick=()=>{ localStorage.removeItem(TOKEN_KEY); ETAG=null; SHA=null; $('#tokState').textContent='Token removed from this browser. Board is read-only.'; render(); };
    document.addEventListener('click', e=>{ if(e.target.id==='backLive'){ e.preventDefault(); localStorage.removeItem(KEY); SOURCE='none'; FP=null; ETAG=null; $('#msg').textContent=''; poll(true); } });
    document.querySelectorAll('dialog .x').forEach(b=>b.onclick=()=>b.closest('dialog').close());
    try { const c = localStorage.getItem(CACHE_KEY); if (c) { setBoard(BM.migrate(JSON.parse(c)), 'cached'); render(); } } catch(e){}
    poll(true).then(() => { if (!BOARD) startOffline(); schedule(); });
  });
  window.atcDebug = () => ({SOURCE, revision: BOARD && BOARD.revision, SHA, ETAG, PENDING: PENDING.length, LAST_SYNC, SYNC_ERR, VIEW});
}
