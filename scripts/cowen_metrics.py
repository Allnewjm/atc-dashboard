#!/usr/bin/env python3
"""Fetch the metrics behind Benjamin Cowen's Bitcoin-bottom framework and write data/cowen.json.

Analysis tracker only, not a forecast. Standard library only. Runs daily in GitHub Actions
(.github/workflows/cowen-metrics.yml) and can be run by hand:  python3 scripts/cowen_metrics.py

Each metric keeps: value, asOf (data date), source, sourceUrl, status (ok | fallback | stale | missing),
lastSuccess (UTC date of the last good fetch), stale (no good fetch for > 3 days) and daily history (~1y).
If a feed fails, the last good value is kept. The file is rewritten only when its content changed.
"""
import csv, datetime as dt, io, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'cowen.json')
UA = {'User-Agent': 'Mozilla/5.0 (atc-dashboard cowen-metrics; +https://github.com/Allnewjm/atc-dashboard)',
      'Accept': 'application/json,text/csv,text/html;q=0.9,*/*;q=0.5'}
STALE_DAYS = 3
KEEP_DAYS = 400
KEY_LEVEL = 60000
DOWNSIDE = 40000
TODAY = dt.datetime.now(dt.timezone.utc).date()
LOG = []

def log(*a):
    s = ' '.join(str(x) for x in a); LOG.append(s); print(s, file=sys.stderr)

def get(url, timeout=40, tries=2):
    err = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:  # noqa
            err = e; time.sleep(3 * (i + 1))
    raise RuntimeError(f'{url}: {err}')

def jget(url, **kw): return json.loads(get(url, **kw))
def d_utc(ts): return dt.datetime.fromtimestamp(float(ts), dt.timezone.utc).date().isoformat()
def r(x, n=2): return None if x is None else round(float(x), n)

def trim(hist):
    cut = (TODAY - dt.timedelta(days=KEEP_DAYS)).isoformat()
    return [p for p in hist if p[0] >= cut]

def merge_hist(old, new):
    m = {p[0]: p[1] for p in (old or [])}
    m.update({p[0]: p[1] for p in (new or []) if p[1] is not None})
    return trim(sorted([[k, v] for k, v in m.items()]))

def value_on_or_before(hist, day):
    best = None
    for d, v in hist:
        if d <= day: best = v
        else: break
    return best

def pct_change(hist, days):
    if not hist: return None
    last_d, last_v = hist[-1]
    base = value_on_or_before(hist, (dt.date.fromisoformat(last_d) - dt.timedelta(days=days)).isoformat())
    if base in (None, 0) or dt.date.fromisoformat(hist[0][0]) > dt.date.fromisoformat(last_d) - dt.timedelta(days=days):
        return None
    return r((last_v / base - 1) * 100, 2)

# ---------- feeds (each returns a dict of metric fields incl. history) ----------
def yahoo(sym):
    j = jget(f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1y&interval=1d')['chart']['result'][0]
    ts, cl = j['timestamp'], j['indicators']['quote'][0]['close']
    off = j['meta'].get('gmtoffset') or 0   # label each bar with the exchange's local date
    hist = merge_hist([], [[d_utc(t + off), r(c, 3)] for t, c in zip(ts, cl) if c is not None])
    if len(hist) < 30: raise RuntimeError(f'yahoo {sym}: too few points')
    return hist

def fred(series):
    txt = get(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}', timeout=60)
    rows = list(csv.reader(io.StringIO(txt)))
    out = []
    for row in rows[1:]:
        if len(row) >= 2 and row[1] not in ('', '.'):
            try: out.append([row[0], float(row[1])])
            except ValueError: pass
    if not out: raise RuntimeError(f'fred {series}: empty')
    return out

def f_btc():
    j = jget('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily')
    pts = j['prices']
    hist = merge_hist([], [[d_utc(t / 1000), r(p, 0)] for t, p in pts[:-1]])
    last_t, last_p = pts[-1]
    # Weekly close = price at the latest Monday 00:00 UTC (end of the Mon-Sun UTC week).
    monday = TODAY - dt.timedelta(days=TODAY.weekday())
    wk = {d_utc(t / 1000): p for t, p in pts}.get(monday.isoformat())
    return dict(value=r(last_p, 0), asOf=dt.datetime.fromtimestamp(last_t / 1000, dt.timezone.utc).isoformat(timespec='minutes'),
                history=hist, weeklyClose=r(wk, 0), weeklyCloseDate=(monday - dt.timedelta(days=1)).isoformat() if wk else None,
                source='CoinGecko', sourceUrl='https://www.coingecko.com/en/coins/bitcoin')

def f_stable():
    j = jget('https://stablecoins.llama.fi/stablecoincharts/all', timeout=60)
    hist = [[d_utc(p['date']), r(p.get('totalCirculatingUSD', {}).get('peggedUSD'), 0)] for p in j]
    hist = merge_hist([], hist)
    return dict(value=hist[-1][1], asOf=hist[-1][0], history=hist, unit='USD',
                source='DefiLlama (all USD-pegged stablecoins)', sourceUrl='https://defillama.com/stablecoins')

def f_usdt():
    g = jget('https://api.coingecko.com/api/v3/global')['data']
    v = g['market_cap_percentage'].get('usdt')
    if v is None: raise RuntimeError('no usdt share')
    day = d_utc(g['updated_at'])
    return dict(value=r(v, 3), asOf=dt.datetime.fromtimestamp(g['updated_at'], dt.timezone.utc).isoformat(timespec='minutes'),
                history=[[day, r(v, 3)]], unit='%', totalMarketCapUsd=r(g['total_market_cap']['usd'], 0),
                source='CoinGecko /global (USDT share of total crypto market cap)', sourceUrl='https://www.coingecko.com/en/global-charts',
                note='Free API has no history of total market cap, so history is stored forward from Nov 18, 2026.')

def f_dxy():
    try:
        hist = yahoo('DX-Y.NYB')
        return dict(value=hist[-1][1], asOf=hist[-1][0], history=hist, label='US Dollar Index (DXY)',
                    source='Yahoo Finance DX-Y.NYB', sourceUrl='https://finance.yahoo.com/quote/DX-Y.NYB/')
    except Exception as e:
        log('dxy yahoo failed:', e)
        hist = trim(fred('DTWEXBGS'))
        return dict(value=r(hist[-1][1], 3), asOf=hist[-1][0], history=hist, label='Broad dollar index (FRED DTWEXBGS, fallback, not DXY)',
                    fallback=True, source='FRED DTWEXBGS (fallback; different index from DXY)', sourceUrl='https://fred.stlouisfed.org/series/DTWEXBGS')

def f_liq():
    try:
        walcl, tga, rrp = fred('WALCL'), fred('WTREGEN'), fred('RRPONTSYD')
        hist = []
        for d, w in trim(walcl):
            t = value_on_or_before(tga, d); rr = value_on_or_before(rrp, d)
            if t is None or rr is None: continue
            hist.append([d, r((w - t) / 1000 - rr, 1)])   # WALCL, WTREGEN: $ millions; RRPONTSYD: $ billions -> $ billions
        last = hist[-1][0]
        return dict(value=hist[-1][1], asOf=last, history=hist, unit='USD bn',
                    parts=dict(walclBn=r(value_on_or_before(walcl, last) / 1000, 1), tgaBn=r(value_on_or_before(tga, last) / 1000, 1),
                               rrpBn=r(value_on_or_before(rrp, last), 1)),
                    source='FRED: WALCL - WTREGEN - RRPONTSYD', sourceUrl='https://fred.stlouisfed.org/series/WALCL')
    except Exception as e:
        log('liquidity FRED failed, trying Fed H.4.1 + Treasury DTS + NY Fed:', e)
    # Fallback: same three pieces from the primary publishers (latest week only; history is stored forward).
    page = get('https://www.federalreserve.gov/releases/h41/current/')
    text = ' '.join(re.sub(r'<[^>]+>', ' ', page).replace('&#xa0;', ' ').replace('&nbsp;', ' ').split())
    i = text.find('Consolidated Statement of Condition of All Federal Reserve Banks')
    m = re.search(r'Wednesday (\w{3}) (\d{1,2}), (\d{4})', text[i:])
    wed = dt.datetime.strptime(' '.join(m.groups()), '%b %d %Y').date().isoformat()
    ta = re.search(r'Total assets ([\d,]+)', text[i:])
    walcl = float(ta.group(1).replace(',', ''))
    dts = jget('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance'
               f'?filter=record_date:lte:{wed},account_type:eq:Treasury General Account (TGA) Closing Balance&sort=-record_date&page%5Bsize%5D=1'.replace(' ', '%20'))['data'][0]
    tga = float(dts['open_today_bal'])
    ops = jget(f'https://markets.newyorkfed.org/api/rp/reverserepo/propositions/search.json?startDate={(dt.date.fromisoformat(wed) - dt.timedelta(days=7)).isoformat()}&endDate={wed}')['repo']['operations']
    ops = sorted([o for o in ops if o.get('operationType') == 'Reverse Repo'], key=lambda o: o['operationDate'])
    rrp = sum(o['totalAmtAccepted'] for o in ops if o['operationDate'] == ops[-1]['operationDate']) / 1e9
    v = r((walcl - tga) / 1000 - rrp, 1)
    return dict(value=v, asOf=wed, history=[[wed, v]], unit='USD bn', fallback=True,
                parts=dict(walclBn=r(walcl / 1000, 1), tgaBn=r(tga / 1000, 1), rrpBn=r(rrp, 1), tgaDate=dts['record_date'], rrpDate=ops[-1]['operationDate']),
                source='Fallback: Fed H.4.1 total assets - Treasury DTS TGA - NY Fed reverse repo', sourceUrl='https://www.federalreserve.gov/releases/h41/current/')

def gold_stats(hist):
    closes = [v for _, v in hist]
    hi52 = max(closes); last = closes[-1]
    hi3m = max(v for d, v in hist if d >= (dt.date.fromisoformat(hist[-1][0]) - dt.timedelta(days=92)).isoformat())
    ma50 = sum(closes[-50:]) / min(50, len(closes))
    # "Turned up": latest close above its 50-day average after a drawdown of at least 5% from the
    # running high at some point in the last 60 sessions.
    window = closes[-60:]; run_hi = max(closes[:-60] or [window[0]]); dd = 0
    for c in window:
        run_hi = max(run_hi, c); dd = max(dd, 1 - c / run_hi)
    return dict(high52w=r(hi52), high3m=r(hi3m), pctOffHigh52w=r((last / hi52 - 1) * 100), pctOffHigh3m=r((last / hi3m - 1) * 100),
                ma50=r(ma50), maxDrawdown60d=r(dd * 100), turnedUp=bool(last > ma50 and dd >= 0.05))

def f_gold():
    try:
        hist = yahoo('GC=F')
        return dict(value=hist[-1][1], asOf=hist[-1][0], history=hist, label='Gold futures (COMEX GC=F)', **gold_stats(hist),
                    source='Yahoo Finance GC=F', sourceUrl='https://finance.yahoo.com/quote/GC=F/')
    except Exception as e:
        log('gold yahoo failed, PAXG fallback:', e)
        j = jget('https://api.coingecko.com/api/v3/coins/pax-gold/market_chart?vs_currency=usd&days=365&interval=daily')
        hist = merge_hist([], [[d_utc(t / 1000), r(p)] for t, p in j['prices']])
        return dict(value=hist[-1][1], asOf=hist[-1][0], history=hist, label='PAX Gold (PAXG, fallback proxy for gold)', fallback=True,
                    **gold_stats(hist), source='CoinGecko PAXG (fallback proxy)', sourceUrl='https://www.coingecko.com/en/coins/pax-gold')

BD = {  # bitcoin-data.com free tier: ~10 req/hour, 15/day per IP; MVRV/realized lag ~7 days without a subscription
    'mvrvZ': ('mvrv-zscore', 'mvrvZscore', 3, 'MVRV Z-score'),
    'realizedPrice': ('realized-price', 'realizedPrice', 0, 'Realized price'),
    'sthRealizedPrice': ('sth-realized-price', 'sthRealizedPrice', 0, 'Short-term-holder realized price'),
    'balancedPrice': ('balanced-price', 'balancedPrice', 0, 'Balanced price'),
}
def f_bd(key):
    path, field, nd, label = BD[key]
    j = jget(f'https://bitcoin-data.com/v1/{path}')
    if isinstance(j, dict): raise RuntimeError(f'bitcoin-data {path}: {str(j)[:120]}')
    hist = merge_hist([], [[p['d'], r(p[field], nd)] for p in j if p.get(field) not in (None, '')])
    lag = (TODAY - dt.date.fromisoformat(hist[-1][0])).days
    note = 'Free tier is delayed about 7 days.' if lag >= 5 else ''
    if key == 'balancedPrice': note = (note + ' "Balanced price" is used as an approximation of what Cowen calls the "balance price".').strip()
    return dict(value=hist[-1][1], asOf=hist[-1][0], history=hist, label=label, lagDays=lag, note=note,
                source=f'bitcoin-data.com /v1/{path}', sourceUrl='https://bitcoin-data.com/')

def f_fng():
    j = jget('https://api.alternative.me/fng/?limit=400&format=json')['data']
    hist = merge_hist([], [[d_utc(p['timestamp']), int(p['value'])] for p in j])
    return dict(value=hist[-1][1], asOf=hist[-1][0], classification=j[0]['value_classification'], history=hist,
                source='alternative.me Crypto Fear & Greed', sourceUrl='https://alternative.me/crypto/fear-and-greed-index/')

FEEDS = [('btc', f_btc), ('stablecoins', f_stable), ('usdtDominance', f_usdt), ('dxy', f_dxy), ('netLiquidity', f_liq),
         ('gold', f_gold)] + [(k, (lambda k=k: f_bd(k))) for k in BD] + [('fearGreed', f_fng)]

def main():
    old = {}
    if os.path.exists(OUT):
        try: old = json.load(open(OUT))
        except Exception as e: log('could not read old file:', e)
    om = old.get('metrics', {})
    metrics = {}
    for key, fn in FEEDS:
        prev = om.get(key) or {}
        try:
            m = fn()
            m['history'] = merge_hist(prev.get('history'), m.get('history'))
            m['status'] = 'fallback' if m.get('fallback') else 'ok'
            m['lastSuccess'] = TODAY.isoformat(); m['stale'] = False; m.pop('error', None)
            log(f'{key}: ok {m["value"]} as of {m["asOf"]} ({m["source"]})')
        except Exception as e:
            log(f'{key}: FAILED {e}')
            m = dict(prev) if prev else dict(value=None, history=[], source=None)
            ls = m.get('lastSuccess')
            m['stale'] = (ls is None) or (TODAY - dt.date.fromisoformat(ls)).days > STALE_DAYS
            m['status'] = 'missing' if m.get('value') is None else ('stale' if m['stale'] else (m.get('status') or 'ok'))
            m['error'] = str(e)[:200]
        metrics[key] = m
    for k in ('stablecoins', 'usdtDominance', 'dxy', 'gold', 'netLiquidity'):
        h = metrics[k].get('history') or []
        metrics[k]['change30d'] = pct_change(h, 30); metrics[k]['change90d'] = pct_change(h, 90)
    if metrics['netLiquidity'].get('history'):
        h = metrics['netLiquidity']['history']; b = value_on_or_before(h, (dt.date.fromisoformat(h[-1][0]) - dt.timedelta(days=30)).isoformat())
        metrics['netLiquidity']['change30dBn'] = r(h[-1][1] - b, 1) if b is not None and len(h) > 1 else None

    v = lambda k: metrics[k].get('value')
    btc, rp, z = v('btc'), v('realizedPrice'), v('mvrvZ')
    sc, dx = metrics['stablecoins'].get('change30d'), metrics['dxy'].get('change30d')
    conds = [
        dict(id='btcBelowRealized', label='BTC at or below realized price', met=None if None in (btc, rp) else btc <= rp),
        dict(id='mvrvZBelowZero', label='MVRV Z-score at or below 0', met=None if z is None else z <= 0),
        dict(id='goldTurnedUp', label='Gold has turned up (close > 50-day avg after a 5%+ drawdown)', met=metrics['gold'].get('turnedUp')),
        dict(id='stablecoinsRising', label='Stablecoin supply rising over 30 days', met=None if sc is None else sc > 0),
        dict(id='dollarFalling', label='Dollar falling over 30 days', met=None if dx is None else dx < 0),
    ]
    wk = metrics['btc'].get('weeklyClose')
    out = dict(
        schema=1,
        title="Benjamin Cowen's Bitcoin-bottom framework (\"Bitcoin: The Bull's Dilemma\", Nov 18, 2026)",
        disclaimer="Tracks the signals Benjamin Cowen uses. Analysis only, not a forecast and not advice.",
        thresholds=dict(keyLevel=KEY_LEVEL, downside=DOWNSIDE, staleDays=STALE_DAYS),
        keyLevel=dict(weeklyClose=wk, weeklyCloseDate=metrics['btc'].get('weeklyCloseDate'),
                      weeklyCloseBelow=None if wk is None else wk < KEY_LEVEL),
        conditions=conds, conditionsMet=sum(1 for c in conds if c['met']), conditionsKnown=sum(1 for c in conds if c['met'] is not None),
        metrics=metrics,
    )
    strip = lambda d: {k: v for k, v in d.items() if k not in ('generatedAt', 'log')}
    if old and json.dumps(strip(old), sort_keys=True) == json.dumps(strip(out), sort_keys=True):
        log('no change; file left as is'); return 0
    out['generatedAt'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    out['log'] = LOG
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT + '.tmp', 'w') as f: json.dump(out, f, separators=(',', ':'))
    os.replace(OUT + '.tmp', OUT)
    log('wrote', OUT)
    return 0

if __name__ == '__main__':
    sys.exit(main())
