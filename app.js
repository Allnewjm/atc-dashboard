'use strict';
// ATC Dashboard. Static, no build. Real data lives only in this browser's localStorage.
const KEY = 'atc-dashboard-data-v1';
const CATS = ['Must-do/household','Legal/divorce','Money/bills','Kids','Work','Business launch','Ambitions/career'];
const MUST = new Set(['Must-do/household','Legal/divorce','Money/bills','Kids','Work']);
const DAY = 86400000;

function dkey(s){ if(!s) return null; if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d=new Date(s); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function parseDay(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); }
function daysBetween(a,b){ return Math.round((parseDay(b)-parseDay(a))/DAY); }
function isActive(i){ return !/PARKED|DONE/i.test(i.status||''); }
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
    out.push({sev: i.priority<=1 ? 3 : 2, type:'OVERDUE', title:`${i.id} ${i.title}`, detail:`Due ${i.due}, ${late} day(s) late. Status ${i.status}.`, day:i.due, refs:[i.id]});
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
  const now = active.filter(i=>/NOW/.test(i.status));
  if(now.length>3) out.push({sev:2,type:'WIP',title:`${now.length} items marked NOW (cap is 3)`,detail:'Theory of Constraints: too much work in progress. Park or close some.',day:T,refs:now.map(i=>i.id)});
  return out.sort((a,b)=>b.sev-a.sev || (a.day||'').localeCompare(b.day||''));
}
function fmtT(s){ const d=new Date(s); return d.toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function fmtD(k){ if(!k) return 'no date'; return parseDay(k).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}); }

if (typeof module !== 'undefined') module.exports = {detectConflicts};

if (typeof document !== 'undefined') {
  const $ = s => document.querySelector(s);
  const esc = s => String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let DATA, CONF;
  function load(){
    try { const raw = localStorage.getItem(KEY); if(raw){ DATA = JSON.parse(raw); DATA._mine = true; return; } } catch(e){}
    DATA = window.SAMPLE_DATA; DATA._mine = false;
  }
  function validate(d){ if(!d || !Array.isArray(d.items)) throw new Error('JSON needs an "items" array'); d.events=d.events||[]; d.goals=d.goals||{}; return d; }
  function render(){
    CONF = detectConflicts(DATA);
    $('#src').innerHTML = DATA._mine ? `<span class="ok">● YOUR DATA</span> ${esc(DATA.label||'')} · built ${esc(DATA.generated||'')}` : `<span class="warn">● DEMO DATA</span> fictional sample. Tap Import and load atc-board-data.json from your Google Drive \"ATC Dashboard\" folder (stays in this browser).`;
    $('#alerts').innerHTML = CONF.length ? CONF.slice(0,12).map((c,i)=>`<button class="alert s${c.sev}" data-c="${i}"><b>${c.type}</b> ${esc(c.title)}</button>`).join('') : '<span class="ok">No conflicts detected. Skies clear.</span>';
    $('#ccount').textContent = CONF.length;
    renderScope(); renderTimeline(); renderBoard(); renderGoals();
  }
  const flagged = id => CONF.filter(c=>c.refs.includes(id));
  function chip(i){
    const f=flagged(i.id); const T=dkey(new Date().toISOString());
    const od = i.due && i.due<T && isActive(i);
    return `<div class="item p${i.priority??4} ${f.length?'hot':''}" data-i="${esc(i.id)}">
      <div class="row"><span class="id">${esc(i.id)}</span><span class="st">${esc(i.status)}</span>${MUST.has(i.category)?'':'<span class="amb">AMBITION</span>'}</div>
      <div class="ttl">${esc(i.title)}</div>
      <div class="row small"><span class="${od?'red':''}">${i.due?'⏱ '+fmtD(i.due):'no date'}</span><span>${esc(i.category)}</span>${f.length?`<span class="red">⚠ ${f.length}</span>`:''}</div></div>`;
  }
  function renderScope(){
    const T=dkey(new Date().toISOString()); const wk=dkey(new Date(Date.now()+7*DAY).toISOString());
    const act=(DATA.items||[]).filter(isActive);
    const score=i=>(i.priority??4)*100 + (i.due? Math.max(-50,Math.min(60,daysBetween(T,i.due))) : 80);
    const now=act.filter(i=>(i.priority??4)<=2 || (i.due&&i.due<=wk)).sort((a,b)=>score(a)-score(b));
    const rest=act.filter(i=>!now.includes(i)).sort((a,b)=>score(a)-score(b));
    const evs=(DATA.events||[]).filter(e=>dkey(e.start)>=T && dkey(e.start)<=wk).sort((a,b)=>a.start.localeCompare(b.start));
    $('#scope').innerHTML = `<div class="radar"><div class="sweep"></div>${now.slice(0,14).map((i,n)=>{const a=n*2.39, r=18+ (Math.min(i.priority??4,4))*16; return `<span class="blip p${i.priority??4}" data-i="${esc(i.id)}" style="left:${50+r*Math.cos(a)}%;top:${50+r*Math.sin(a)}%" title="${esc(i.title)}">${esc(i.id)}</span>`}).join('')}</div>
      <div class="cols2"><section><h3>ON RADAR · now / this week (${now.length})</h3>${now.map(chip).join('')}</section>
      <section><h3>NEXT 7 DAYS · calendar</h3>${evs.map(e=>`<div class="ev" data-e="${esc(e.id)}"><b>${e.allDay?fmtD(dkey(e.start)):fmtT(e.start)}</b> ${esc(e.title)}</div>`).join('')||'<i>nothing booked</i>'}
      <h3>HOLDING PATTERN (${rest.length})</h3>${rest.map(chip).join('')}</section></div>`;
  }
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
    const act=(DATA.items||[]).filter(i=>i.status!=='DONE');
    const cats=[...CATS, ...new Set(act.map(i=>i.category).filter(c=>!CATS.includes(c)))];
    $('#board').innerHTML = `<div class="kan">${cats.map(c=>{const a=act.filter(i=>i.category===c).sort((x,y)=>(x.priority??4)-(y.priority??4)); return `<div class="col ${MUST.has(c)?'must':'ambc'}"><h3>${esc(c)} <small>${a.length}</small></h3><div class="tag">${MUST.has(c)?'MUST-DO':'AMBITION'}</div>${a.map(chip).join('')}</div>`}).join('')}</div>`;
  }
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
    if(t.dataset.i){ const i=DATA.items.find(x=>x.id===t.dataset.i); if(!i) return; const f=flagged(i.id);
      return show(`<h2>${esc(i.id)} ${esc(i.title)}</h2><p><b>Status</b> ${esc(i.status)} · <b>Owner</b> ${esc(i.owner)} · <b>Category</b> ${esc(i.category)}</p><p><b>Due</b> ${i.due?fmtD(i.due):'none'}</p><p>${esc(i.notes)}</p>${f.map(c=>`<p class="red">⚠ ${c.type}: ${esc(c.detail)}</p>`).join('')}`); }
    if(t.dataset.e){ const ev=DATA.events.find(x=>x.id===t.dataset.e); if(!ev) return;
      return show(`<h2>${esc(ev.title)}</h2><p>${ev.allDay?fmtD(dkey(ev.start))+' (all day)':fmtT(ev.start)+' to '+fmtT(ev.end)}</p><p>${esc(ev.category)}${ev.block?' · time block':''}</p>`); }
  });
  function importText(txt){ try{ const d=validate(JSON.parse(txt)); localStorage.setItem(KEY,JSON.stringify(d)); load(); render(); $('#imp').close(); $('#msg').textContent='Imported '+d.items.length+' items, '+d.events.length+' events. Stored only in this browser.'; } catch(err){ $('#impErr').textContent='Import failed: '+err.message; } }
  window.atcImport = importText;
  window.addEventListener('DOMContentLoaded',()=>{
    load(); render();
    $('#btnImport').onclick=()=>{ $('#impErr').textContent=''; $('#imp').showModal(); };
    $('#file').onchange=e=>{ const f=e.target.files[0]; if(f) f.text().then(importText); };
    $('#doPaste').onclick=()=>importText($('#paste').value);
    $('#btnClear').onclick=()=>{ if(confirm('Remove your data from this browser and show the demo?')){ localStorage.removeItem(KEY); load(); render(); } };
    document.querySelectorAll('dialog .x').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  });
}
