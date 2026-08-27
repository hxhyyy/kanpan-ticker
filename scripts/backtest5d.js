/**
 * 近 5 天 MSTRUSDT 短线策略回测（1m）
 * 规则对齐插件 Ref：1h 窗口 lo/hi、tgt≥0.4、go 门禁、扣费+滑点
 */
const https = require('https');

const MIN_PROFIT = 0.4;
const FEE_RATE = 0.0004;
const SLIPPAGE_RATE = 0.0002;
const BARS = 60; // 1h @ 1m
const STEP = 20; // 每 20 分钟决策一次，避免过密
const MAX_HOLD = 60;

function httpGet(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchFuturesKlinesRange(symbol, interval, startMs, endMs) {
  const all = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url =
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}` +
      `&startTime=${cursor}&endTime=${endMs}&limit=1500`;
    let body;
    try {
      body = await httpGet(url);
    } catch {
      body = await httpGet(
        `https://fapi1.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}` +
          `&startTime=${cursor}&endTime=${endMs}&limit=1500`
      );
    }
    const rows = JSON.parse(body);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      all.push({
        t: r[0],
        open: parseFloat(r[1]),
        high: parseFloat(r[2]),
        low: parseFloat(r[3]),
        close: parseFloat(r[4]),
        volume: parseFloat(r[5]),
      });
    }
    const lastT = rows[rows.length - 1][0];
    if (lastT <= cursor) break;
    cursor = lastT + 1;
    if (rows.length < 1500) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // 去重
  const map = new Map();
  for (const c of all) map.set(c.t, c);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

async function fetchSpotKlinesRange(symbol, interval, startMs, endMs) {
  const all = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const path =
      `/api/v3/klines?symbol=${symbol}&interval=${interval}` +
      `&startTime=${cursor}&endTime=${endMs}&limit=1500`;
    let body;
    try {
      body = await httpGet(`https://data-api.binance.vision${path}`);
    } catch {
      body = await httpGet(`https://api.binance.com${path}`);
    }
    const rows = JSON.parse(body);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      all.push({
        t: r[0],
        open: parseFloat(r[1]),
        high: parseFloat(r[2]),
        low: parseFloat(r[3]),
        close: parseFloat(r[4]),
        volume: parseFloat(r[5]),
      });
    }
    const lastT = rows[rows.length - 1][0];
    if (lastT <= cursor) break;
    cursor = lastT + 1;
    if (rows.length < 1500) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const map = new Map();
  for (const c of all) map.set(c.t, c);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function atr(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function medianRange(candles) {
  const rs = candles.map((c) => c.high - c.low).filter((r) => r > 0).sort((a, b) => a - b);
  if (!rs.length) return 0;
  return rs[Math.floor(rs.length / 2)];
}

function targetMove(candles, width, a) {
  const med = medianRange(candles);
  let step = Math.max(MIN_PROFIT, med * 1.4, a * 0.55);
  if (width > 0) step = Math.min(step, width * 0.45);
  return round2(Math.max(Math.min(step, 2.5), MIN_PROFIT));
}

function sessionOf(ts) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    }).format(new Date(ts))
  );
  return hour >= 22 || hour < 5 ? 'us' : 'asia';
}

function inRangePct(candles, lo, hi) {
  const closes = candles.map((c) => c.close);
  let n = 0;
  for (const c of closes) if (c >= lo && c <= hi) n++;
  return closes.length ? (n / closes.length) * 100 : 0;
}

function shortBeta(mstr, btc) {
  const len = Math.min(mstr.length, btc.length);
  if (len < 10) return 1.8;
  const mr = [];
  const br = [];
  const o = mstr.length - len;
  const bo = btc.length - len;
  for (let i = 1; i < len; i++) {
    const mp = mstr[o + i - 1].close;
    const mc = mstr[o + i].close;
    const bp = btc[bo + i - 1].close;
    const bc = btc[bo + i].close;
    if (mp <= 0 || bp <= 0) continue;
    mr.push(Math.log(mc / mp));
    br.push(Math.log(bc / bp));
  }
  if (mr.length < 5) return 1.8;
  const mm = mr.reduce((a, b) => a + b, 0) / mr.length;
  const bm = br.reduce((a, b) => a + b, 0) / br.length;
  let cov = 0;
  let vb = 0;
  for (let i = 0; i < mr.length; i++) {
    cov += (mr[i] - mm) * (br[i] - bm);
    vb += (br[i] - bm) ** 2;
  }
  if (vb <= 0) return 1.8;
  const beta = cov / vb;
  return beta > 0.3 && beta < 5 ? beta : 1.8;
}

function decide(mstrSlice, btcSlice, ts) {
  const lows = mstrSlice.map((c) => c.low);
  const highs = mstrSlice.map((c) => c.high);
  const a = atr(mstrSlice);
  const buf = a * 0.3;
  const support = round2(Math.max(Math.min(...lows) - buf, Math.min(...lows) * 0.998));
  const resistance = round2(Math.max(...highs) + buf);
  const price = mstrSlice[mstrSlice.length - 1].close;
  const width = round2(resistance - support);
  const pos = width > 0 ? Math.max(0, Math.min(100, ((price - support) / width) * 100)) : 50;
  const tgt = targetMove(mstrSlice, width, a);
  const inPct = inRangePct(mstrSlice, support, resistance);
  const ses = sessionOf(ts);

  const entryTol = Math.max(0.1, tgt * 0.22);
  const stopPad = Math.max(MIN_PROFIT * 0.75, tgt * 0.75);
  const longTp = round2(Math.min(price + tgt, resistance));
  const shortTp = round2(Math.max(price - tgt, support));
  const longMove = longTp - price;
  const shortMove = price - shortTp;

  let side = 'neutral';
  let tp = longTp;
  let sl = round2(support - stopPad);
  let expected = longMove;

  if (pos < 35 && longMove >= MIN_PROFIT) {
    side = 'long';
    tp = longTp;
    sl = round2(support - stopPad);
    expected = longMove;
  } else if (pos > 65 && shortMove >= MIN_PROFIT) {
    side = 'short';
    tp = shortTp;
    sl = round2(resistance + stopPad);
    expected = shortMove;
  } else if (pos <= 45 && longMove >= MIN_PROFIT && price - support <= entryTol + 0.15) {
    side = 'long';
    tp = longTp;
    sl = round2(support - stopPad);
    expected = longMove;
  } else if (pos >= 55 && shortMove >= MIN_PROFIT && resistance - price <= entryTol + 0.15) {
    side = 'short';
    tp = shortTp;
    sl = round2(resistance + stopPad);
    expected = shortMove;
  }

  const feeRt = price * (FEE_RATE + SLIPPAGE_RATE) * 2;
  const netExp = expected - feeRt;

  // BTC alignment
  const bLows = btcSlice.map((c) => c.low);
  const bHighs = btcSlice.map((c) => c.high);
  const ba = atr(btcSlice);
  const bSup = Math.min(...bLows) - ba * 0.3;
  const bRes = Math.max(...bHighs) + ba * 0.3;
  const bPx = btcSlice[btcSlice.length - 1].close;
  const mPos = width > 0 ? (price - support) / width : 0.5;
  const bW = bRes - bSup;
  const bPos = bW > 0 ? (bPx - bSup) / bW : 0.5;
  const posDiff = Math.abs(mPos - bPos);
  const alignment = posDiff <= 0.2 ? 'aligned' : posDiff >= 0.4 ? 'diverged' : 'neutral';

  let suitable = inPct >= 65 && width >= tgt * 1.5;
  if (width < tgt * 1.2 || inPct < 50) suitable = false;

  let tradeable = true;
  let reason = 'ok';
  if (ses === 'asia' && width < tgt * 1.8) {
    tradeable = false;
    reason = 'asia_narrow';
  } else if (!suitable) {
    tradeable = false;
    reason = 'unsuitable';
  } else if (inPct < 60) {
    tradeable = false;
    reason = 'in_low';
  } else if (side === 'neutral') {
    tradeable = false;
    reason = 'mid';
  } else if (netExp < MIN_PROFIT * 0.85) {
    tradeable = false;
    reason = 'net_low';
  } else if (alignment === 'diverged') {
    tradeable = false;
    reason = 'btc_div';
  } else if (side === 'long' && pos > 50) {
    tradeable = false;
    reason = 'long_high';
  } else if (side === 'short' && pos < 50) {
    tradeable = false;
    reason = 'short_low';
  }

  return { tradeable, reason, side, tp, sl, expected, ses, width, pos, inPct, tgt, price };
}

function alignBtc(mstr, btc) {
  // 按时间戳对齐：对每根 mstr，取 <= t 的最近 btc
  const out = [];
  let j = 0;
  for (const m of mstr) {
    while (j + 1 < btc.length && btc[j + 1].t <= m.t) j++;
    out.push(btc[j] || btc[0]);
  }
  return out;
}

function summarize(trades, label) {
  if (!trades.length) {
    return { label, n: 0, wr: 0, avg: 0, sum: 0, maxDd: 0 };
  }
  let wins = 0;
  let sum = 0;
  let peak = 0;
  let eq = 0;
  let maxDd = 0;
  for (const t of trades) {
    if (t.net > 0) wins++;
    sum += t.net;
    eq += t.net;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak - eq);
  }
  return {
    label,
    n: trades.length,
    wr: (wins / trades.length) * 100,
    avg: sum / trades.length,
    sum,
    maxDd,
  };
}

async function main() {
  const endMs = Date.now();
  const startMs = endMs - 5 * 24 * 60 * 60 * 1000;
  console.log('拉取近5天 1m K 线…');
  const [mstr, btcRaw] = await Promise.all([
    fetchFuturesKlinesRange('MSTRUSDT', '1m', startMs, endMs),
    fetchSpotKlinesRange('BTCUSDT', '1m', startMs, endMs),
  ]);
  console.log(`MSTRUSDT: ${mstr.length} 根, BTCUSDT: ${btcRaw.length} 根`);
  if (mstr.length < BARS + 100) {
    console.error('数据不足');
    process.exit(1);
  }

  const btc = alignBtc(mstr, btcRaw);
  const trades = [];
  let i = BARS + 5;
  while (i < mstr.length - 5) {
    const mSlice = mstr.slice(i - BARS, i);
    const bSlice = btc.slice(i - BARS, i);
    const ts = mstr[i].t;
    const d = decide(mSlice, bSlice, ts);
    if (!d.tradeable || d.side === 'neutral') {
      i += STEP;
      continue;
    }

    const rawEntry = mstr[i].close;
    const entry = rawEntry * (1 + (d.side === 'long' ? SLIPPAGE_RATE : -SLIPPAGE_RATE));
    let exitPrice = rawEntry;
    let closed = false;
    let exitReason = 'timeout';
    for (let j = i + 1; j < Math.min(i + MAX_HOLD, mstr.length); j++) {
      const c = mstr[j];
      if (d.side === 'long') {
        if (c.low <= d.sl) {
          exitPrice = d.sl * (1 - SLIPPAGE_RATE);
          closed = true;
          exitReason = 'sl';
          break;
        }
        if (c.high >= d.tp) {
          exitPrice = d.tp * (1 - SLIPPAGE_RATE);
          closed = true;
          exitReason = 'tp';
          break;
        }
      } else {
        if (c.high >= d.sl) {
          exitPrice = d.sl * (1 + SLIPPAGE_RATE);
          closed = true;
          exitReason = 'sl';
          break;
        }
        if (c.low <= d.tp) {
          exitPrice = d.tp * (1 + SLIPPAGE_RATE);
          closed = true;
          exitReason = 'tp';
          break;
        }
      }
    }
    if (!closed) {
      const last = mstr[Math.min(i + MAX_HOLD - 1, mstr.length - 1)].close;
      exitPrice = last * (1 + (d.side === 'long' ? -SLIPPAGE_RATE : SLIPPAGE_RATE));
    }

    const gross = d.side === 'long' ? exitPrice - entry : entry - exitPrice;
    const fees = entry * FEE_RATE + Math.abs(exitPrice) * FEE_RATE;
    const net = gross - fees;
    trades.push({
      t: ts,
      ses: d.ses,
      side: d.side,
      entry,
      exit: exitPrice,
      net,
      exitReason,
      width: d.width,
    });
    i += Math.max(STEP, 5); // 成交后至少错开几根
  }

  const all = summarize(trades, 'all');
  const us = summarize(
    trades.filter((t) => t.ses === 'us'),
    'us'
  );
  const asia = summarize(
    trades.filter((t) => t.ses === 'asia'),
    'asia'
  );
  const longs = summarize(
    trades.filter((t) => t.side === 'long'),
    'long'
  );
  const shorts = summarize(
    trades.filter((t) => t.side === 'short'),
    'short'
  );

  const tpN = trades.filter((t) => t.exitReason === 'tp').length;
  const slN = trades.filter((t) => t.exitReason === 'sl').length;
  const toN = trades.filter((t) => t.exitReason === 'timeout').length;

  function print(s) {
    console.log(
      `${s.label.padEnd(6)} n=${String(s.n).padStart(3)}  wr=${s.wr.toFixed(1).padStart(5)}%  ` +
        `avg=${(s.avg >= 0 ? '+' : '') + s.avg.toFixed(3)}  ` +
        `sum=${(s.sum >= 0 ? '+' : '') + s.sum.toFixed(2)}  ` +
        `maxDD=${s.maxDd.toFixed(2)}`
    );
  }

  console.log('\n===== 近5天 MSTRUSDT 短线回测（1m，窗口1h，扣费+滑点）=====');
  console.log(`样本: ${new Date(mstr[0].t).toISOString()} ~ ${new Date(mstr[mstr.length - 1].t).toISOString()}`);
  console.log(`决策: 每~${STEP}分钟检查；持仓最长 ${MAX_HOLD} 分钟；tgt≥${MIN_PROFIT}`);
  console.log(`出场: tp=${tpN}  sl=${slN}  timeout=${toN}`);
  console.log('');
  print(all);
  print(us);
  print(asia);
  print(longs);
  print(shorts);
  console.log('\n说明: sum/avg 单位为美元/合约价差（约等于每股净利，未乘杠杆与仓位）。');
  console.log('us=北京22:00-05:00；asia=其余时段。仅 go y 才开仓。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
