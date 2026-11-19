/* COWEN tab: Benjamin Cowen's Bitcoin-bottom framework tracker. Analysis only, not a forecast.
   Reads data/cowen.json (written daily by .github/workflows/cowen-metrics.yml) and data/cowen-calendar.json.
   "Refresh" re-fetches the browser-friendly feeds (CoinGecko, DefiLlama, bitcoin-data.com, alternative.me);
   Yahoo (DXY, gold) and FRED (liquidity) values always come from the daily job. No tokens are used here. */
(function () {
  'use strict';
  const WF_URL = 'https://github.com/Allnewjm/atc-dashboard/actions/workflows/cowen-metrics.yml';
  const BD_KEY = 'atc.cowen.bdLast';            // bitcoin-data.com free tier: ~10 requests/hour, 15/day per IP
  const BD_MIN_GAP = 60 * 60 * 1000;
  let D = null, CAL = null, LIVE = {}, REFRESHED = null, BUSY = false, LOADED = false, FEEDLOG = [];
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const CT = {timeZone: 'America/Chicago'};
  const fmtCT = iso => { if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return esc(iso);
    return d.toLocaleString('en-US', Object.assign({month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}, CT)) + ' CT'; };
  const fmtDay = s => { if (!s) return '—'; if (/T/.test(s)) return fmtCT(s); const d = new Date(s + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}); };
  const usd = (v, d = 0) => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
  const big = v => v == null ? '—' : v >= 1e12 ? '$' + (v / 1e12).toFixed(2) + 'T' : '$' + (v / 1e9).toFixed(1) + 'B';
  const pct = (v, d = 2) => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d) + '%';
  const num = (v, d = 2) => v == null ? '—' : Number(v).toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
  const M = k => Object.assign({}, (D && D.metrics && D.metrics[k]) || {}, LIVE[k] || {});

  function pctChange(hist, days) {
    if (!hist || hist.length < 2) return null;
    const last = hist[hist.length - 1], t = new Date(last[0]); t.setUTCDate(t.getUTCDate() - days);
    const cut = t.toISOString().slice(0, 10); if (hist[0][0] > cut) return null;
    let base = null; for (const p of hist) { if (p[0] <= cut) base = p[1]; else break; }
    return base ? +((last[1] / base - 1) * 100).toFixed(2) : null;
  }

  function conditions() {
    const btc = M('btc').value, rp = M('realizedPrice').value, z = M('mvrvZ').value, g = M('gold'), sc = M('stablecoins').change30d, dx = M('dxy').change30d;
    const nn = v => v == null;
    return [
      {label: 'BTC at or below realized price', met: nn(btc) || nn(rp) ? null : btc <= rp, detail: `${usd(btc)} vs ${usd(rp)}`},
      {label: 'MVRV Z-score at or below 0', met: nn(z) ? null : z <= 0, detail: `Z = ${num(z, 2)}`},
      {label: 'Gold has turned up', met: g.turnedUp == null ? null : !!g.turnedUp, detail: `close ${usd(g.value, 1)} vs 50-day avg ${usd(g.ma50, 1)}; drawdown in last 60 sessions ${num(g.maxDrawdown60d, 1)}%`},
      {label: 'Stablecoin supply rising (30 days)', met: nn(sc) ? null : sc > 0, detail: pct(sc)},
      {label: 'Dollar falling (30 days)', met: nn(dx) ? null : dx < 0, detail: pct(dx) + (M('dxy').fallback ? ' (broad dollar fallback)' : '')},
    ];
  }

  // ---------- tiny SVG line chart ----------
  function chart(series, opts) {
    opts = opts || {}; const W = 640, H = opts.h || 180, P = {l: 56, r: 10, t: 10, b: 22};
    const all = []; series.forEach(s => s.data.forEach(p => p[1] != null && all.push(p)));
    if (all.length < 2) return '<p class="small">Not enough history yet; it builds up a day at a time.</p>';
    const xs = all.map(p => Date.parse(p[0])), x0 = Math.min(...xs), x1 = Math.max(...xs);
    let ys = all.map(p => p[1]).concat((opts.lines || []).filter(l => l.inRange !== false).map(l => l.y));
    let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0) * 0.06 || 1; y0 -= pad; y1 += pad;
    const X = t => P.l + (t - x0) / ((x1 - x0) || 1) * (W - P.l - P.r), Y = v => H - P.b - (v - y0) / ((y1 - y0) || 1) * (H - P.t - P.b);
    const fy = opts.fmt || (v => num(v, 0));
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v);
      g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" class="cw-gl"/><text x="${P.l - 4}" y="${y + 3}" class="cw-ax" text-anchor="end">${esc(fy(v))}</text>`; }
    const d0 = new Date(x0), d1 = new Date(x1), lab = d => d.toLocaleDateString('en-US', {month: 'short', year: '2-digit', timeZone: 'UTC'});
    g += `<text x="${P.l}" y="${H - 6}" class="cw-ax">${lab(d0)}</text><text x="${W - P.r}" y="${H - 6}" class="cw-ax" text-anchor="end">${lab(d1)}</text>`;
    (opts.lines || []).forEach(l => { if (l.y < y0 || l.y > y1) return; const y = Y(l.y);
      g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="${l.color}" stroke-dasharray="5 4" stroke-width="1.2"/><text x="${W - P.r - 2}" y="${y - 3}" fill="${l.color}" class="cw-ax" text-anchor="end">${esc(l.label)}</text>`; });
    series.forEach(s => { const pts = s.data.filter(p => p[1] != null).map(p => `${X(Date.parse(p[0])).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
      g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.w || 1.6}"${s.dash ? ' stroke-dasharray="4 3"' : ''}/>`; });
    const legend = series.length > 1 || (opts.lines || []).length ? `<div class="cw-legend">${series.map(s => `<span style="color:${s.color}">━ ${esc(s.name)}</span>`).join('')}${(opts.lines || []).map(l => `<span style="color:${l.color}">┅ ${esc(l.label)}</span>`).join('')}</div>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" class="cw-chart" role="img" aria-label="${esc(opts.title || 'chart')}">${g}</svg>${legend}`;
  }
  const lastN = (h, days) => { if (!h || !h.length) return []; const t = new Date(h[h.length - 1][0]); t.setUTCDate(t.getUTCDate() - days); const c = t.toISOString().slice(0, 10); return h.filter(p => p[0] >= c); };
  const sma = (h, n) => h.map((p, i) => i < n - 1 ? [p[0], null] : [p[0], h.slice(i - n + 1, i + 1).reduce((a, q) => a + q[1], 0) / n]);

  function badge(m) {
    const st = m.status || 'missing', cls = st === 'ok' ? 'ok' : st === 'fallback' ? 'warn' : 'red';
    const lab = st === 'ok' ? 'OK' : st === 'fallback' ? 'FALLBACK' : st === 'stale' ? 'STALE' : 'MISSING';
    return `<span class="cw-badge ${cls}">${m.live ? 'LIVE' : lab}</span>`;
  }
  const src = m => `<div class="small">as of ${fmtDay(m.asOf)} · <a href="${esc(m.sourceUrl || '#')}" target="_blank" rel="noopener">${esc(m.source || 'source')}</a> ${badge(m)}${m.note ? `<br>${esc(m.note)}` : ''}</div>`;
  const card = (title, body, m, cls) => `<div class="cw-card ${cls || ''}"><div class="cw-ct">${esc(title)}</div>${body}${m ? src(m) : ''}</div>`;

  function render() {
    const v = $('#cowen'); if (!v) return;
    if (!D) { v.innerHTML = `<h3>COWEN · BITCOIN-BOTTOM FRAMEWORK</h3><p class="small">${LOADED ? 'Could not load data/cowen.json.' : 'Loading…'}</p>`; return; }
    const t = D.thresholds || {keyLevel: 60000, downside: 40000}, conds = conditions(), met = conds.filter(c => c.met).length, known = conds.filter(c => c.met != null).length;
    const btc = M('btc'), rp = M('realizedPrice'), bp = M('balancedPrice'), sth = M('sthRealizedPrice'), z = M('mvrvZ'), sc = M('stablecoins'),
      ud = M('usdtDominance'), dx = M('dxy'), liq = M('netLiquidity'), gd = M('gold'), fg = M('fearGreed'), kl = D.keyLevel || {};
    const dist = btc.value ? (btc.value / t.keyLevel - 1) * 100 : null;
    const klState = kl.weeklyCloseBelow ? ['red', 'Weekly close BELOW $60K: Cowen\'s "lower lows" branch'] : btc.value && btc.value < t.keyLevel ? ['warn', 'Trading below $60K intraweek; watch the weekly close'] : ['warn', 'Holding above $60K (amber: within his danger zone)'];
    const histBtc = (btc.history || []).slice(); if (btc.live && btc.value) histBtc.push([new Date().toISOString().slice(0, 10), btc.value]);
    const liveNote = REFRESHED ? `Refreshed ${fmtCT(REFRESHED)} (browser feeds). ` : '';
    v.innerHTML = `
<div class="cw-head"><div><h3 style="margin-top:0">COWEN · BITCOIN-BOTTOM FRAMEWORK</h3>
<p class="cw-disc">Tracks the signals <b>Benjamin Cowen</b> uses in "Bitcoin: The Bull's Dilemma" (Nov 18, 2026). <b>Analysis only, not a forecast and not advice.</b> Thresholds are his framing, not proven rules.</p>
<p class="small">Daily data job: ${fmtCT(D.generatedAt)} · ${esc(liveNote)}<span id="cw-status">${esc(FEEDLOG.join(' · '))}</span></p></div>
<div class="cw-actions"><button id="cw-refresh"${BUSY ? ' disabled' : ''}>${BUSY ? 'Refreshing…' : '↻ Refresh'}</button>
<a class="cw-full" href="${WF_URL}" target="_blank" rel="noopener">Full refresh (GitHub) ↗</a>
<div class="small cw-help">↻ Refresh re-fetches the live browser feeds now (BTC, USDT share, stablecoins, on-chain at most hourly, Fear &amp; Greed). DXY, gold and Fed liquidity come from the daily job. For a full refresh, open the GitHub link, click <b>Run workflow</b> (signed in), and reload this page a minute or two after it finishes.</div></div></div>

<div class="cw-summary ${met >= 3 ? 'warn' : ''}"><div class="cw-big">${met} of 5</div><div><b>bottom conditions met</b>${known < 5 ? ` <span class="small">(${5 - known} unknown)</span>` : ''}
<ul class="cw-checks">${conds.map(c => `<li class="${c.met == null ? 'dim' : c.met ? 'ok' : 'no'}">${c.met == null ? '?' : c.met ? '✔' : '✘'} ${esc(c.label)} <span class="small">${esc(c.detail)}</span></li>`).join('')}</ul></div></div>

<div class="cw-grid">
${card('BTC vs the $60K line', `<div class="cw-val">${usd(btc.value)}</div><div class="${dist != null && dist < 0 ? 'red' : 'warn'}">${pct(dist, 1)} vs $60K</div>
<div class="small">Last weekly close (week ended ${fmtDay(kl.weeklyCloseDate)}): ${usd(kl.weeklyClose)}</div><div class="${klState[0]}" style="font-size:12px">${esc(klState[1])}</div>
<div class="small">Downside scenario: below ${usd(t.downside)} (balanced price ${usd(bp.value)})</div>`, btc, 'wide')}
${card('Stablecoin supply', `<div class="cw-val">${big(sc.value)}</div><div class="small">30d ${'<span class="' + (sc.change30d < 0 ? 'red' : 'ok') + '">' + pct(sc.change30d) + '</span>'} · 90d ${pct(sc.change90d)}</div><div class="small">Falling supply = bearish in his view.</div>`, sc)}
${card('USDT dominance', `<div class="cw-val">${num(ud.value, 2)}%</div><div class="small">30d ${pct(ud.change30d)} · rising = bearish</div>`, ud)}
${card(dx.fallback ? 'Broad dollar (DXY fallback)' : 'US Dollar Index (DXY)', `<div class="cw-val">${num(dx.value, 2)}</div><div class="small">30d <span class="${dx.change30d > 0 ? 'red' : 'ok'}">${pct(dx.change30d)}</span> · 90d ${pct(dx.change90d)} · rising = headwind</div>`, dx)}
${card('Fed net liquidity', `<div class="cw-val">${liq.value == null ? '—' : '$' + num(liq.value / 1000, 3) + 'T'}</div><div class="small">30d ${liq.change30dBn == null ? '—' : (liq.change30dBn > 0 ? '+' : '') + num(liq.change30dBn, 1) + 'B'} · ${liq.parts ? `balance sheet $${num(liq.parts.walclBn, 0)}B − TGA $${num(liq.parts.tgaBn, 0)}B − RRP $${num(liq.parts.rrpBn, 1)}B` : ''}</div><div class="small">Weekly (Wednesday). Falling = tightening.</div>`, liq)}
${card('Gold first?', `<div class="cw-val">${usd(gd.value, 1)}</div><div class="small">${pct(gd.pctOffHigh52w, 1)} off 52w high (${usd(gd.high52w, 0)}) · ${pct(gd.pctOffHigh3m, 1)} off 3m high · 50d avg ${usd(gd.ma50, 0)}</div>
<div class="${gd.turnedUp ? 'ok' : 'red'}" style="font-size:12px">${gd.turnedUp ? 'Turned up: possible early bottom tell' : 'Not turned up yet'}</div>`, gd)}
${card('MVRV Z-score', `<div class="cw-val">${num(z.value, 2)}</div><div class="small">Past bottoms reached ≤ 0.</div>`, z)}
${card('Realized price', `<div class="cw-val">${usd(rp.value)}</div><div class="small">BTC ${btc.value && rp.value ? pct((btc.value / rp.value - 1) * 100, 1) : '—'} vs realized</div>`, rp)}
${card('Balanced price', `<div class="cw-val">${usd(bp.value)}</div><div class="small">Matches his sub-$40K scenario.</div>`, bp)}
${card('STH realized price', `<div class="cw-val">${usd(sth.value)}</div><div class="small">Context: short-term holders' cost basis.</div>`, sth)}
${card('Fear & Greed', `<div class="cw-val">${fg.value == null ? '—' : fg.value}</div><div class="small">${esc(fg.classification || '')}</div>`, fg)}
</div>

<h3>BTC · 1 YEAR, WITH $60K, REALIZED AND BALANCED PRICE</h3>
${chart([{name: 'BTC', color: '#39ff8f', data: lastN(histBtc, 365)}, {name: 'Realized', color: '#57c7ff', data: lastN(rp.history, 365), dash: 1}, {name: 'Balanced', color: '#b48cff', data: lastN(bp.history, 365), dash: 1}],
  {h: 220, title: 'BTC', fmt: v => '$' + Math.round(v / 1000) + 'K', lines: [{y: t.keyLevel, label: '$60K', color: '#ffb83d'}, {y: t.downside, label: '$40K', color: '#ff4d4d'}]})}
<div class="cols2">
<div><h3>STABLECOIN SUPPLY</h3>${chart([{name: 'Stablecoins', color: '#39ff8f', data: lastN(sc.history, 365)}], {fmt: v => '$' + Math.round(v / 1e9) + 'B'})}</div>
<div><h3>MVRV Z-SCORE</h3>${chart([{name: 'MVRV Z', color: '#57c7ff', data: lastN(z.history, 365)}], {fmt: v => v.toFixed(1), lines: [{y: 0, label: '0', color: '#ff4d4d', inRange: false}]})}</div>
<div><h3>${dx.fallback ? 'BROAD DOLLAR (FALLBACK)' : 'DXY'}</h3>${chart([{name: 'DXY', color: '#ffb83d', data: lastN(dx.history, 365)}], {fmt: v => v.toFixed(1)})}</div>
<div><h3>FED NET LIQUIDITY</h3>${chart([{name: 'Net liquidity', color: '#39ff8f', data: lastN(liq.history, 365)}], {fmt: v => '$' + (v / 1000).toFixed(2) + 'T'})}</div>
<div><h3>GOLD WITH 50-DAY AVERAGE</h3>${chart([{name: 'Gold', color: '#ffd166', data: lastN(gd.history, 365)}, {name: '50-day avg', color: '#5f8f75', data: lastN(sma(gd.history || [], 50), 365), dash: 1}], {fmt: v => '$' + Math.round(v)})}</div>
<div><h3>USDT DOMINANCE</h3>${chart([{name: 'USDT %', color: '#57c7ff', data: lastN(ud.history, 365)}], {fmt: v => v.toFixed(2) + '%'})}</div>
</div>

<h3>CALENDAR (HAND-EDITED)</h3>${calendar()}

<h3>SOURCES AND FRESHNESS</h3><table class="cw-src"><tr><th>Metric</th><th>Value</th><th>As of</th><th>Status</th><th>Source</th></tr>
${['btc', 'stablecoins', 'usdtDominance', 'dxy', 'netLiquidity', 'gold', 'mvrvZ', 'realizedPrice', 'sthRealizedPrice', 'balancedPrice', 'fearGreed'].map(k => { const m = M(k);
  return `<tr><td>${esc(m.label || k)}</td><td>${esc(m.value == null ? '—' : num(m.value, m.value > 1000 ? 0 : 2))}</td><td>${fmtDay(m.asOf)}</td><td>${badge(m)}${m.stale ? ' <span class="red small">no good fetch for 3+ days</span>' : ''}${m.error ? ` <span class="small" title="${esc(m.error)}">last fetch failed</span>` : ''}</td><td><a href="${esc(m.sourceUrl || '#')}" target="_blank" rel="noopener">${esc(m.source || '')}</a></td></tr>`; }).join('')}
</table><p class="small">Stale = no successful fetch for more than ${t.staleDays || 3} days (last good value kept). On-chain MVRV Z, realized and STH realized prices lag about 7 days on bitcoin-data.com's free tier. "Balanced price" approximates Cowen's "balance price". Gold "turned up" = close above its 50-day average after a 5%+ drawdown within the last 60 sessions.</p>`;
    $('#cw-refresh').onclick = refresh;
  }

  function calendar() {
    if (!CAL) return '<p class="small">Calendar not loaded.</p>';
    const today = new Date().toLocaleDateString('en-CA', CT);
    const ev = (CAL.events || []).filter(e => (e.end || e.date) >= today);
    return `<div class="cw-cal">${ev.map(e => `<div class="ev"><b>${fmtDay(e.date)}${e.end ? '–' + fmtDay(e.end).replace(/, \d{4}$/, '') : ''}</b> ${esc(e.title)}${e.detail ? `<div class="small">${esc(e.detail)}</div>` : ''}<div class="small"><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.source)}</a></div></div>`).join('')}
${(CAL.notes || []).map(n => `<div class="ev"><b>${esc(n.title)}</b><div class="small">${esc(n.detail)}</div><div class="small"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.source)}</a></div></div>`).join('')}</div><p class="small">${esc(CAL.note || '')} Updated ${fmtDay(CAL.updated)}.</p>`;
  }

  async function j(url) { const r = await fetch(url, {cache: 'no-store'}); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); }

  async function liveBtc() {
    const p = await j('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true');
    LIVE.btc = Object.assign(LIVE.btc || {}, {value: Math.round(p.bitcoin.usd), asOf: new Date(p.bitcoin.last_updated_at * 1000).toISOString(), live: true, status: 'ok', source: 'CoinGecko (live)'});
  }

  async function refresh() {
    if (BUSY) return; BUSY = true; FEEDLOG = []; render();
    const tasks = {
      'BTC': liveBtc,
      'USDT share': async () => { const g = (await j('https://api.coingecko.com/api/v3/global')).data;
        const h = (M('usdtDominance').history || []).filter(p => p[0] < new Date().toISOString().slice(0, 10)).concat([[new Date().toISOString().slice(0, 10), +g.market_cap_percentage.usdt.toFixed(3)]]);
        LIVE.usdtDominance = {value: g.market_cap_percentage.usdt, asOf: new Date(g.updated_at * 1000).toISOString(), live: true, status: 'ok', history: h, change30d: pctChange(h, 30)}; },
      'Stablecoins': async () => { const a = await j('https://stablecoins.llama.fi/stablecoincharts/all');
        const h = a.map(p => [new Date(p.date * 1000).toISOString().slice(0, 10), (p.totalCirculatingUSD || {}).peggedUSD]).filter(p => p[1] != null);
        const yr = lastN(h, 400), last = h[h.length - 1];
        LIVE.stablecoins = {value: last[1], asOf: last[0], live: true, status: 'ok', history: yr, change30d: pctChange(h, 30), change90d: pctChange(h, 90)}; },
      'Fear & Greed': async () => { const f = (await j('https://api.alternative.me/fng/?limit=1')).data[0];
        LIVE.fearGreed = {value: +f.value, classification: f.value_classification, asOf: new Date(f.timestamp * 1000).toISOString().slice(0, 10), live: true, status: 'ok'}; },
      'On-chain': async () => {
        const last = +localStorage.getItem(BD_KEY) || 0;
        if (Date.now() - last < BD_MIN_GAP) throw new Error('skipped (at most hourly; free-tier limit)');
        localStorage.setItem(BD_KEY, String(Date.now()));
        const map = {mvrvZ: ['mvrv-zscore', 'mvrvZscore'], realizedPrice: ['realized-price', 'realizedPrice'], sthRealizedPrice: ['sth-realized-price', 'sthRealizedPrice'], balancedPrice: ['balanced-price', 'balancedPrice']};
        await Promise.all(Object.entries(map).map(async ([k, [path, f]]) => { const r = await j('https://bitcoin-data.com/v1/' + path + '/last');
          if (r[f] == null) throw new Error(path); const val = +r[f];
          const h = (M(k).history || []).filter(p => p[0] < r.d).concat([[r.d, val]]);
          LIVE[k] = {value: val, asOf: r.d, history: h, live: true, status: 'ok'}; }));
      },
    };
    const res = await Promise.allSettled(Object.entries(tasks).map(([n, fn]) => fn().then(() => n + ' ✓', e => { throw new Error(n + ': ' + (e.message || e)); })));
    FEEDLOG = res.map(r => r.status === 'fulfilled' ? r.value : r.reason.message.replace(/https?:\/\/\S+/, '').trim());
    REFRESHED = new Date().toISOString(); BUSY = false; render();
  }

  async function load() {
    try {
      const [d, c] = await Promise.all([j('data/cowen.json?t=' + Date.now()), j('data/cowen-calendar.json?t=' + Date.now()).catch(() => null)]);
      D = d; CAL = c;
    } catch (e) { console.warn('cowen load failed', e); }
    LOADED = true; render();
    if (D) liveBtc().then(render).catch(() => {});
  }

  document.addEventListener('click', e => { const b = e.target.closest('[data-tab="cowen"]'); if (b && !LOADED) { render(); load(); } });
  function deepLink() { if (location.hash === '#cowen') { const b = document.querySelector('[data-tab="cowen"]'); if (b) b.click(); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', deepLink); else deepLink();
  window.addEventListener('hashchange', deepLink);
})();
