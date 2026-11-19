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
      {label: 'BTC at or below realized price', met: nn(btc) || nn(rp) ? null : btc <= rp, detail: `${usd(btc)} vs ${usd(rp)}`,
        threshold: 'BTC ≤ realized price',
        why: 'Realized price is the average on-chain cost basis of all bitcoins. In his framework, Bitcoin trading at or below that level has historically marked cycle-bottom territory. It is a condition he watches, not a standalone timing trigger.'},
      {label: 'MVRV Z-score at or below 0', met: nn(z) ? null : z <= 0, detail: `Z = ${num(z, 2)}`,
        threshold: 'Z ≤ 0',
        why: 'MVRV Z-score measures how extended Bitcoin\'s market value is versus its realized (on-chain cost) value, adjusted for volatility. He has pointed to readings at or below 0 as the zone where past cycle bottoms formed. A print near zero is a condition, not a forecast that a bottom is in.'},
      {label: 'Gold has turned up', met: g.turnedUp == null ? null : !!g.turnedUp, detail: `close ${usd(g.value, 1)} vs 50-day avg ${usd(g.ma50, 1)}; drawdown in last 60 sessions ${num(g.maxDrawdown60d, 1)}%`,
        threshold: 'Close above the 50-day average after a 5%+ drawdown in the last 60 sessions',
        why: 'Gold has often bottomed and turned higher before Bitcoin during risk-off stretches. He treats a close back above the 50-day average after a meaningful drawdown as an early-bottom tell — a possible lead, not confirmation that Bitcoin itself has bottomed.'},
      {label: 'Stablecoin supply rising (30 days)', met: nn(sc) ? null : sc > 0, detail: pct(sc),
        threshold: '30-day change > 0',
        why: 'Stablecoin supply is his proxy for dry powder sitting on the sidelines of crypto. A falling 30-day supply means liquidity is leaving the system and is bearish in his view; a rising supply is the supportive condition on this checklist.'},
      {label: 'Dollar falling (30 days)', met: nn(dx) ? null : dx < 0, detail: pct(dx) + (M('dxy').fallback ? ' (broad dollar fallback)' : ''),
        threshold: '30-day change < 0',
        why: 'A rising U.S. dollar (DXY) is a headwind for Bitcoin and other risk assets in his framework. He watches for the dollar to decline over a 30-day window as one of the conditions that has historically accompanied bottoms.'},
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
  const src = (m, label) => `<div class="small">${label ? esc(label) + ': ' : ''}as of ${fmtDay(m.asOf)} · <a href="${esc(m.sourceUrl || '#')}" target="_blank" rel="noopener">${esc(m.source || 'source')}</a> ${badge(m)}${m.note ? `<br>${esc(m.note)}` : ''}</div>`;
  function tipBtn(text) {
    if (!text) return '';
    return ` <span class="cw-tipwrap"><button type="button" class="cw-info" aria-expanded="false" aria-label="About this measure">ⓘ</button><div class="cw-tip" hidden role="tooltip"><b>Cowen's view:</b> ${esc(text)}</div></span>`;
  }
  const card = (title, body, m, cls, tip) => `<div class="cw-card ${cls || ''}"><div class="cw-ct">${esc(title)}${tipBtn(tip)}</div>${body}${m ? src(m) : ''}</div>`;

  function condBlock(c, body, metrics, chartHtml) {
    const state = c.met == null ? 'dim' : c.met ? 'ok' : 'no';
    const mark = c.met == null ? '?' : c.met ? '✔' : '✘';
    const status = c.met == null ? 'Unknown' : c.met ? 'Met' : 'Not met';
    return `<section class="cw-cond ${state}">
<div class="cw-cond-head"><span class="cw-mark">${mark}</span><div>
<div class="cw-cond-title">${esc(c.label)}${tipBtn(c.why)}</div>
<div class="cw-cond-meta">${status} · Threshold: ${esc(c.threshold)}</div></div></div>
${body}${chartHtml || ''}${(metrics || []).map(([m, lab]) => src(m, lab)).join('')}</section>`;
  }

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

<div class="cw-summary ${met >= 3 ? 'warn' : ''}"><div class="cw-big">${met} of 5</div><div><b>bottom conditions met</b>${known < 5 ? ` <span class="small">(${5 - known} unknown)</span>` : ''}</div></div>

${condBlock(conds[0],
  `<div class="cw-val">${usd(btc.value)} vs ${usd(rp.value)}</div><div class="small">BTC ${btc.value && rp.value ? pct((btc.value / rp.value - 1) * 100, 1) : '—'} vs realized</div>`,
  [[btc, 'Bitcoin price'], [rp, 'Realized price']],
  chart([{name: 'BTC', color: '#39ff8f', data: lastN(histBtc, 365)}, {name: 'Realized', color: '#57c7ff', data: lastN(rp.history, 365), dash: 1}],
    {h: 200, title: 'BTC vs realized price', fmt: v => '$' + Math.round(v / 1000) + 'K'}))}

${condBlock(conds[1],
  `<div class="cw-val">${num(z.value, 2)}</div><div class="small">Past bottoms reached ≤ 0.</div>`,
  [[z, 'MVRV Z-score']],
  chart([{name: 'MVRV Z', color: '#57c7ff', data: lastN(z.history, 365)}], {fmt: v => v.toFixed(1), lines: [{y: 0, label: '0', color: '#ff4d4d', inRange: false}]}))}

${condBlock(conds[2],
  `<div class="cw-val">${usd(gd.value, 1)}</div><div class="small">${pct(gd.pctOffHigh52w, 1)} off 52w high (${usd(gd.high52w, 0)}) · ${pct(gd.pctOffHigh3m, 1)} off 3m high</div><div class="small">${esc(conds[2].detail)}</div>`,
  [[gd, 'Gold']],
  chart([{name: 'Gold', color: '#ffd166', data: lastN(gd.history, 365)}, {name: '50-day avg', color: '#5f8f75', data: lastN(sma(gd.history || [], 50), 365), dash: 1}], {fmt: v => '$' + Math.round(v)}))}

${condBlock(conds[3],
  `<div class="cw-val">${big(sc.value)}</div><div class="small">30d ${'<span class="' + (sc.change30d < 0 ? 'red' : 'ok') + '">' + pct(sc.change30d) + '</span>'} · 90d ${pct(sc.change90d)}</div><div class="small">Falling supply = bearish in his view.</div>`,
  [[sc, 'Stablecoin supply']],
  chart([{name: 'Stablecoins', color: '#39ff8f', data: lastN(sc.history, 365)}], {fmt: v => '$' + Math.round(v / 1e9) + 'B'}))}

${condBlock(conds[4],
  `<div class="cw-val">${num(dx.value, 2)}</div><div class="small">30d <span class="${dx.change30d > 0 ? 'red' : 'ok'}">${pct(dx.change30d)}</span> · 90d ${pct(dx.change90d)} · rising = headwind${dx.fallback ? ' · broad dollar fallback' : ''}</div>`,
  [[dx, dx.fallback ? 'Broad dollar (DXY fallback)' : 'US Dollar Index (DXY)']],
  chart([{name: 'DXY', color: '#ffb83d', data: lastN(dx.history, 365)}], {fmt: v => v.toFixed(1)}))}

<h3>CONTEXT (NOT SCORED)</h3>
<p class="small">These help read the setup but do not count toward the 5 bottom conditions.</p>
<div class="cw-grid">
${card('BTC vs the $60K line', `<div class="cw-val">${usd(btc.value)}</div><div class="${dist != null && dist < 0 ? 'red' : 'warn'}">${pct(dist, 1)} vs $60K</div>
<div class="small">Last weekly close (week ended ${fmtDay(kl.weeklyCloseDate)}): ${usd(kl.weeklyClose)}</div><div class="${klState[0]}" style="font-size:12px">${esc(klState[1])}</div>
<div class="small">Downside scenario: below ${usd(t.downside)}</div>`, btc, 'wide', 'A weekly close below $60K would open his “lower lows” branch; holding above it stays in the danger zone but is not that path.')}
${card('Balanced price', `<div class="cw-val">${usd(bp.value)}</div><div class="small">Matches his sub-$40K scenario.</div>`, bp, '', 'Balanced (or “balance”) price is the level he uses when sketching a sub-$40K downside scenario.')}
${card('STH realized price', `<div class="cw-val">${usd(sth.value)}</div><div class="small">Context: short-term holders' cost basis.</div>`, sth, '', 'Short-term holders’ average cost basis, shown here as context rather than a scored bottom condition.')}
${card('USDT dominance', `<div class="cw-val">${num(ud.value, 2)}%</div><div class="small">30d ${pct(ud.change30d)} · rising = bearish</div>`, ud, '', 'A rising USDT share of total crypto market cap is bearish for Bitcoin in his framework.')}
${card('Fed net liquidity', `<div class="cw-val">${liq.value == null ? '—' : '$' + num(liq.value / 1000, 3) + 'T'}</div><div class="small">30d ${liq.change30dBn == null ? '—' : (liq.change30dBn > 0 ? '+' : '') + num(liq.change30dBn, 1) + 'B'} · ${liq.parts ? `balance sheet $${num(liq.parts.walclBn, 0)}B − TGA $${num(liq.parts.tgaBn, 0)}B − RRP $${num(liq.parts.rrpBn, 1)}B` : ''}</div><div class="small">Weekly (Wednesday). Falling = tightening.</div>`, liq, '', 'Net liquidity is the Fed’s balance sheet minus the Treasury general account and reverse repo; a falling reading means tightening conditions.')}
${card('Fear & Greed', `<div class="cw-val">${fg.value == null ? '—' : fg.value}</div><div class="small">${esc(fg.classification || '')}</div>`, fg, '', 'An optional sentiment gauge. Extreme fear has sometimes coincided with bottoms, but it is not one of his five scored conditions.')}
</div>
<h3>BTC · 1 YEAR, WITH $60K AND BALANCED PRICE</h3>
${chart([{name: 'BTC', color: '#39ff8f', data: lastN(histBtc, 365)}, {name: 'Balanced', color: '#b48cff', data: lastN(bp.history, 365), dash: 1}],
  {h: 220, title: 'BTC vs key levels', fmt: v => '$' + Math.round(v / 1000) + 'K', lines: [{y: t.keyLevel, label: '$60K', color: '#ffb83d'}, {y: t.downside, label: '$40K', color: '#ff4d4d'}]})}
<div class="cols2">
<div><h3>FED NET LIQUIDITY</h3>${chart([{name: 'Net liquidity', color: '#39ff8f', data: lastN(liq.history, 365)}], {fmt: v => '$' + (v / 1000).toFixed(2) + 'T'})}</div>
<div><h3>USDT DOMINANCE</h3>${chart([{name: 'USDT %', color: '#57c7ff', data: lastN(ud.history, 365)}], {fmt: v => v.toFixed(2) + '%'})}</div>
</div>

<h3>CALENDAR (HAND-EDITED)</h3>${calendar()}

<h3>SOURCES AND FRESHNESS</h3><table class="cw-src"><tr><th>Metric</th><th>Value</th><th>As of</th><th>Status</th><th>Source</th></tr>
${['btc', 'stablecoins', 'usdtDominance', 'dxy', 'netLiquidity', 'gold', 'mvrvZ', 'realizedPrice', 'sthRealizedPrice', 'balancedPrice', 'fearGreed'].map(k => { const m = M(k);
  const LBL = {btc: 'Bitcoin price', stablecoins: 'Stablecoin supply (USD)', usdtDominance: 'USDT dominance (%)', netLiquidity: 'Fed net liquidity ($bn)', fearGreed: 'Fear & Greed'};
  return `<tr><td>${esc(LBL[k] || m.label || k)}</td><td>${esc(m.value == null ? '—' : num(m.value, m.value > 1000 || k === 'fearGreed' ? 0 : 2))}</td><td>${fmtDay(m.asOf)}</td><td>${badge(m)}${m.stale ? ' <span class="red small">no good fetch for 3+ days</span>' : ''}${m.error ? ` <span class="small" title="${esc(m.error)}">last fetch failed</span>` : ''}</td><td><a href="${esc(m.sourceUrl || '#')}" target="_blank" rel="noopener">${esc(m.source || '')}</a></td></tr>`; }).join('')}
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

  function closeTips() {
    document.querySelectorAll('#cowen .cw-info[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    document.querySelectorAll('#cowen .cw-tip').forEach(t => { t.hidden = true; t.classList.remove('open'); t.style.left = t.style.right = t.style.top = t.style.bottom = ''; });
  }
  function placeTip(tip) {
    tip.style.left = '0'; tip.style.right = 'auto'; tip.style.top = 'calc(100% + 6px)'; tip.style.bottom = 'auto';
    const r = tip.getBoundingClientRect(), pad = 8;
    if (r.right > window.innerWidth - pad) { tip.style.left = 'auto'; tip.style.right = '0'; }
    const r2 = tip.getBoundingClientRect();
    if (r2.left < pad) { tip.style.left = '0'; tip.style.right = 'auto'; }
    if (r2.bottom > window.innerHeight - pad) { tip.style.top = 'auto'; tip.style.bottom = 'calc(100% + 6px)'; }
  }
  document.addEventListener('click', e => {
    const root = document.getElementById('cowen'); if (!root) return;
    const btn = e.target.closest('.cw-info');
    if (btn && root.contains(btn)) {
      const tip = btn.parentElement && btn.parentElement.querySelector('.cw-tip');
      const open = btn.getAttribute('aria-expanded') === 'true';
      closeTips();
      if (!open && tip) { btn.setAttribute('aria-expanded', 'true'); tip.hidden = false; tip.classList.add('open'); placeTip(tip); }
      e.preventDefault();
      return;
    }
    if (!e.target.closest('.cw-tip')) closeTips();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTips(); });
})();
