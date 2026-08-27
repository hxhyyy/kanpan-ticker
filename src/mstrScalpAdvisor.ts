import type { Candle } from './chartData';
import { fetchBtcCandles, fetchMstrCandles, type ChartInterval } from './chartData';

export type ScalpWindow = '1h' | '2h' | '4h';
export type MstrSession = 'us' | 'asia';

/** 单次操作至少值得赚的价差（美元） */
const MIN_PROFIT = 0.4;
/** 单边手续费（默认 taker 0.04%） */
const FEE_RATE = 0.0004;
/** 单边估计滑点 */
const SLIPPAGE_RATE = 0.0002;

export interface ScalpBacktest {
  /** 回测样本描述 */
  sample: string;
  trades: number;
  winRate: number;
  avgNet: number;
  totalNet: number;
  maxDrawdown: number;
}

export interface MstrScalpReport {
  window: ScalpWindow;
  interval: ChartInterval;
  mstrSource: string;
  btcSource: string;
  mstrPrice: number;
  targetMove: number;
  session: MstrSession;
  sessionHint: string;
  range: {
    support: number;
    resistance: number;
    mid: number;
    width: number;
    positionPct: number;
    atr: number;
    inRangePct: number;
    suitable: boolean;
    suitableReason: string;
  };
  levels: number[];
  action: {
    side: 'long' | 'short' | 'neutral';
    entryZone: [number, number];
    takeProfit: number;
    stopLoss: number;
    expectedMove: number;
    hint: string;
  };
  fees: {
    roundTripUsd: number;
    netExpectedMove: number;
  };
  gate: {
    tradeable: boolean;
    reason: string;
  };
  btc: {
    price: number;
    support: number;
    resistance: number;
    beta: number;
    mappedSupport: number;
    mappedResistance: number;
    alignment: 'aligned' | 'diverged' | 'neutral';
    hint: string;
  };
  score: number;
  scoreHint: string;
  backtest: ScalpBacktest | null;
  notes: string[];
  refreshedAt: number;
}

function windowConfig(window: ScalpWindow): { interval: ChartInterval; bars: number } {
  switch (window) {
    case '1h':
      return { interval: '1m', bars: 60 };
    case '2h':
      return { interval: '1m', bars: 120 };
    case '4h':
      return { interval: '5m', bars: 48 };
  }
}

export function getMstrSession(now = new Date()): MstrSession {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    }).format(now)
  );
  // 美股正盘约北京 22:30–05:00，简化为 22–5
  if (hour >= 22 || hour < 5) {
    return 'us';
  }
  return 'asia';
}

export function sessionHint(session: MstrSession): string {
  return session === 'us' ? '美股活跃时段' : '亚洲时段，MSTR 波动常偏弱';
}

export function computeAtr(candles: Candle[], period = 14): number {
  if (candles.length < 2) {
    return 0;
  }
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    if (Number.isFinite(tr)) {
      trs.push(tr);
    }
  }
  const slice = trs.slice(-period);
  if (slice.length === 0) {
    return 0;
  }
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function roundPrice(price: number): number {
  return Math.round(price * 100) / 100;
}

function medianBarRange(candles: Candle[]): number {
  const ranges = candles.map((c) => c.high - c.low).filter((r) => Number.isFinite(r) && r > 0);
  if (ranges.length === 0) {
    return 0;
  }
  ranges.sort((a, b) => a - b);
  return ranges[Math.floor(ranges.length / 2)];
}

export function computeTargetMove(candles: Candle[], width: number, atr: number): number {
  const med = medianBarRange(candles);
  let step = Math.max(MIN_PROFIT, med * 1.4, atr * 0.55);
  if (width > 0) {
    step = Math.min(step, width * 0.45);
  }
  step = Math.min(step, 2.5);
  return roundPrice(Math.max(step, MIN_PROFIT));
}

function roundTripCostUsd(price: number): number {
  return price * (FEE_RATE + SLIPPAGE_RATE) * 2;
}

function buildLevels(support: number, resistance: number, step: number): number[] {
  if (step <= 0 || resistance <= support) {
    return [roundPrice(support), roundPrice(resistance)];
  }
  const start = Math.floor(support / step) * step;
  const levels: number[] = [];
  for (let p = start; p <= resistance + step * 0.01; p += step) {
    levels.push(roundPrice(p));
  }
  if (levels.length < 2) {
    return [roundPrice(support), roundPrice(resistance)];
  }
  return levels;
}

function inRangeStats(candles: Candle[], lower: number, upper: number): { inRangePct: number } {
  const closes = candles.map((c) => c.close).filter(Number.isFinite);
  let inRange = 0;
  for (const close of closes) {
    if (close >= lower && close <= upper) {
      inRange++;
    }
  }
  return {
    inRangePct: closes.length > 0 ? (inRange / closes.length) * 100 : 0,
  };
}

function computeShortBeta(mstrCandles: Candle[], btcCandles: Candle[]): number {
  const len = Math.min(mstrCandles.length, btcCandles.length);
  if (len < 10) {
    return 1.8;
  }
  const mstrRets: number[] = [];
  const btcRets: number[] = [];
  const offset = mstrCandles.length - len;
  const btcOffset = btcCandles.length - len;
  for (let i = 1; i < len; i++) {
    const mPrev = mstrCandles[offset + i - 1].close;
    const mCur = mstrCandles[offset + i].close;
    const bPrev = btcCandles[btcOffset + i - 1].close;
    const bCur = btcCandles[btcOffset + i].close;
    if (mPrev <= 0 || bPrev <= 0) {
      continue;
    }
    mstrRets.push(Math.log(mCur / mPrev));
    btcRets.push(Math.log(bCur / bPrev));
  }
  if (mstrRets.length < 5) {
    return 1.8;
  }
  const mMean = mstrRets.reduce((a, b) => a + b, 0) / mstrRets.length;
  const bMean = btcRets.reduce((a, b) => a + b, 0) / btcRets.length;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < mstrRets.length; i++) {
    const dm = mstrRets[i] - mMean;
    const db = btcRets[i] - bMean;
    cov += dm * db;
    varB += db * db;
  }
  if (varB <= 0) {
    return 1.8;
  }
  const beta = cov / varB;
  return Number.isFinite(beta) && beta > 0.3 && beta < 5 ? beta : 1.8;
}

function mapBtcLevelToMstr(
  btcLevel: number,
  btcAnchor: number,
  mstrAnchor: number,
  beta: number
): number {
  const btcMovePct = (btcLevel - btcAnchor) / btcAnchor;
  return roundPrice(mstrAnchor * (1 + btcMovePct * beta));
}

function deriveAction(
  price: number,
  support: number,
  resistance: number,
  positionPct: number,
  targetMove: number,
  levels: number[]
): MstrScalpReport['action'] {
  const entryTol = Math.max(0.1, targetMove * 0.22);
  const stopPad = Math.max(MIN_PROFIT * 0.75, targetMove * 0.75);

  const below = levels.filter((g) => g <= price);
  const above = levels.filter((g) => g >= price);
  const anchorLow = below.length > 0 ? below[below.length - 1] : roundPrice(support);
  const anchorHigh = above.length > 0 ? above[0] : roundPrice(resistance);
  const distLow = price - anchorLow;
  const distHigh = anchorHigh - price;

  const longTp = roundPrice(Math.min(price + targetMove, resistance));
  const shortTp = roundPrice(Math.max(price - targetMove, support));
  const longMove = longTp - price;
  const shortMove = price - shortTp;

  if (distLow <= entryTol && positionPct <= 45 && longMove >= MIN_PROFIT) {
    return {
      side: 'long',
      entryZone: [roundPrice(anchorLow - entryTol), roundPrice(anchorLow + entryTol)],
      takeProfit: longTp,
      stopLoss: roundPrice(support - stopPad),
      expectedMove: roundPrice(longMove),
      hint: `近下沿做多，目标 +$${longMove.toFixed(2)}`,
    };
  }
  if (distHigh <= entryTol && positionPct >= 55 && shortMove >= MIN_PROFIT) {
    return {
      side: 'short',
      entryZone: [roundPrice(anchorHigh - entryTol), roundPrice(anchorHigh + entryTol)],
      takeProfit: shortTp,
      stopLoss: roundPrice(resistance + stopPad),
      expectedMove: roundPrice(shortMove),
      hint: `近上沿做空，目标 -$${shortMove.toFixed(2)}`,
    };
  }
  if (positionPct < 35 && longMove >= MIN_PROFIT) {
    return {
      side: 'long',
      entryZone: [roundPrice(support), roundPrice(support + entryTol)],
      takeProfit: longTp,
      stopLoss: roundPrice(support - stopPad),
      expectedMove: roundPrice(longMove),
      hint: `偏下 (${positionPct.toFixed(0)}%)，低吸 +$${longMove.toFixed(2)}`,
    };
  }
  if (positionPct > 65 && shortMove >= MIN_PROFIT) {
    return {
      side: 'short',
      entryZone: [roundPrice(resistance - entryTol), roundPrice(resistance)],
      takeProfit: shortTp,
      stopLoss: roundPrice(resistance + stopPad),
      expectedMove: roundPrice(shortMove),
      hint: `偏上 (${positionPct.toFixed(0)}%)，高抛 -$${shortMove.toFixed(2)}`,
    };
  }

  const waitMove = positionPct <= 50 ? longMove : shortMove;
  return {
    side: 'neutral',
    entryZone: [roundPrice(price - entryTol), roundPrice(price + entryTol)],
    takeProfit: positionPct <= 50 ? longTp : shortTp,
    stopLoss: roundPrice(support - stopPad),
    expectedMove: roundPrice(Math.max(waitMove, MIN_PROFIT)),
    hint: '中部，等靠近上下沿',
  };
}

function evaluateGate(input: {
  session: MstrSession;
  suitable: boolean;
  suitableReason: string;
  inRangePct: number;
  width: number;
  targetMove: number;
  actionSide: MstrScalpReport['action']['side'];
  netExpectedMove: number;
  alignment: MstrScalpReport['btc']['alignment'];
  positionPct: number;
}): MstrScalpReport['gate'] {
  const {
    session,
    suitable,
    suitableReason,
    inRangePct,
    width,
    targetMove,
    actionSide,
    netExpectedMove,
    alignment,
    positionPct,
  } = input;

  if (session === 'asia' && width < targetMove * 1.8) {
    return { tradeable: false, reason: '亚洲时段区间偏窄' };
  }
  if (!suitable) {
    return { tradeable: false, reason: suitableReason };
  }
  if (inRangePct < 60) {
    return { tradeable: false, reason: '震荡占比不足' };
  }
  if (actionSide === 'neutral') {
    return { tradeable: false, reason: '中部观望' };
  }
  if (netExpectedMove < MIN_PROFIT * 0.85) {
    return { tradeable: false, reason: '扣费后空间不足' };
  }
  if (alignment === 'diverged') {
    return { tradeable: false, reason: 'BTC 背离' };
  }
  if (actionSide === 'long' && positionPct > 50) {
    return { tradeable: false, reason: '做多但位置偏高' };
  }
  if (actionSide === 'short' && positionPct < 50) {
    return { tradeable: false, reason: '做空但位置偏低' };
  }
  return { tradeable: true, reason: '条件满足' };
}

function computeScore(
  inRangePct: number,
  width: number,
  targetMove: number,
  suitable: boolean,
  alignment: string,
  session: MstrSession,
  tradeable: boolean
): number {
  let score = 50;
  if (inRangePct >= 70) {
    score += 25;
  } else if (inRangePct >= 55) {
    score += 15;
  } else if (inRangePct < 45) {
    score -= 20;
  }
  if (width >= targetMove * 2) {
    score += 15;
  } else if (width < targetMove * 1.2) {
    score -= 15;
  }
  if (suitable) {
    score += 10;
  }
  if (alignment === 'aligned') {
    score += 10;
  } else if (alignment === 'diverged') {
    score -= 10;
  }
  if (session === 'us') {
    score += 8;
  } else {
    score -= 8;
  }
  if (tradeable) {
    score += 10;
  } else {
    score -= 12;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** 滚动窗口简易回测（扣双边手续费+滑点） */
export function backtestScalp(
  mstrCandles: Candle[],
  btcCandles: Candle[],
  window: ScalpWindow
): ScalpBacktest | null {
  const { bars } = windowConfig(window);
  const minStart = bars + 5;
  if (mstrCandles.length < minStart + bars) {
    return null;
  }

  const step = Math.max(10, Math.floor(bars / 3));
  const maxHold = bars;
  let trades = 0;
  let wins = 0;
  let totalNet = 0;
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;

  for (let i = minStart; i < mstrCandles.length - 5; i += step) {
    const mstrSlice = mstrCandles.slice(i - bars, i);
    const btcSlice = btcCandles.slice(i - bars, i);
    if (mstrSlice.length < bars || btcSlice.length < bars) {
      continue;
    }

    const snap = analyzeMstrScalp(mstrSlice, btcSlice, window, windowConfig(window).interval, 'bt', 'bt', {
      skipBacktest: true,
    });
    if (!snap.gate.tradeable || snap.action.side === 'neutral') {
      continue;
    }

    const side = snap.action.side;
    const rawEntry = mstrCandles[i].close;
    const entry = rawEntry * (1 + (side === 'long' ? SLIPPAGE_RATE : -SLIPPAGE_RATE));
    const tp = snap.action.takeProfit;
    const sl = snap.action.stopLoss;

    let exitPrice = rawEntry;
    let closed = false;
    for (let j = i + 1; j < Math.min(i + maxHold, mstrCandles.length); j++) {
      const c = mstrCandles[j];
      if (side === 'long') {
        if (c.low <= sl) {
          exitPrice = sl * (1 - SLIPPAGE_RATE);
          closed = true;
          break;
        }
        if (c.high >= tp) {
          exitPrice = tp * (1 - SLIPPAGE_RATE);
          closed = true;
          break;
        }
      } else {
        if (c.high >= sl) {
          exitPrice = sl * (1 + SLIPPAGE_RATE);
          closed = true;
          break;
        }
        if (c.low <= tp) {
          exitPrice = tp * (1 + SLIPPAGE_RATE);
          closed = true;
          break;
        }
      }
    }
    if (!closed) {
      const last = mstrCandles[Math.min(i + maxHold - 1, mstrCandles.length - 1)].close;
      exitPrice = last * (1 + (side === 'long' ? -SLIPPAGE_RATE : SLIPPAGE_RATE));
    }

    const gross = side === 'long' ? exitPrice - entry : entry - exitPrice;
    const fees = entry * FEE_RATE + Math.abs(exitPrice) * FEE_RATE;
    const net = gross - fees;
    trades++;
    if (net > 0) {
      wins++;
    }
    totalNet += net;
    equity += net;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const hours = Math.round(mstrCandles.length / (window === '4h' ? 12 : 60));
  return {
    sample: `~${hours}h`,
    trades,
    winRate: trades > 0 ? (wins / trades) * 100 : 0,
    avgNet: trades > 0 ? totalNet / trades : 0,
    totalNet,
    maxDrawdown,
  };
}

export function analyzeMstrScalp(
  mstrCandles: Candle[],
  btcCandles: Candle[],
  window: ScalpWindow,
  interval: ChartInterval,
  mstrSource: string,
  btcSource: string,
  opts?: { skipBacktest?: boolean }
): MstrScalpReport {
  const { bars } = windowConfig(window);
  const mstrSlice = mstrCandles.slice(-bars);
  const btcSlice = btcCandles.slice(-bars);

  const lows = mstrSlice.map((c) => c.low);
  const highs = mstrSlice.map((c) => c.high);
  const rawSupport = Math.min(...lows);
  const rawResistance = Math.max(...highs);
  const atr = computeAtr(mstrSlice);
  const buffer = atr * 0.3;
  const support = roundPrice(Math.max(rawSupport - buffer, rawSupport * 0.998));
  const resistance = roundPrice(rawResistance + buffer);
  const mstrPrice = mstrSlice.at(-1)?.close ?? support;
  const mid = roundPrice((support + resistance) / 2);
  const width = roundPrice(resistance - support);
  const positionPct =
    width > 0 ? Math.max(0, Math.min(100, ((mstrPrice - support) / width) * 100)) : 50;

  const targetMove = computeTargetMove(mstrSlice, width, atr);
  const levels = buildLevels(support, resistance, targetMove);
  const { inRangePct } = inRangeStats(mstrSlice, support, resistance);
  const session = getMstrSession();
  const sessHint = sessionHint(session);

  let suitable = false;
  let suitableReason = '';
  if (inRangePct >= 65 && width >= targetMove * 1.5) {
    suitable = true;
    suitableReason = `${inRangePct.toFixed(0)}% 在区间内，宽 $${width.toFixed(2)}`;
  } else if (width < targetMove * 1.2) {
    suitable = false;
    suitableReason = `区间 $${width.toFixed(2)} 偏窄`;
  } else if (inRangePct < 50) {
    suitable = false;
    suitableReason = `仅 ${inRangePct.toFixed(0)}% 在区间内，偏趋势`;
  } else {
    suitable = true;
    suitableReason = `震荡尚可，tgt $${targetMove.toFixed(2)}`;
  }

  const action = deriveAction(mstrPrice, support, resistance, positionPct, targetMove, levels);
  const roundTripUsd = roundTripCostUsd(mstrPrice);
  const netExpectedMove = roundPrice(Math.max(0, action.expectedMove - roundTripUsd));

  const btcLows = btcSlice.map((c) => c.low);
  const btcHighs = btcSlice.map((c) => c.high);
  const btcAtr = computeAtr(btcSlice);
  const btcSupport = btcSlice.length > 0 ? Math.min(...btcLows) - btcAtr * 0.3 : 0;
  const btcResistance = btcSlice.length > 0 ? Math.max(...btcHighs) + btcAtr * 0.3 : 0;
  const btcPrice = btcSlice.at(-1)?.close ?? 0;
  const beta = computeShortBeta(mstrSlice, btcSlice);
  const mappedSupport = mapBtcLevelToMstr(btcSupport, btcPrice, mstrPrice, beta);
  const mappedResistance = mapBtcLevelToMstr(btcResistance, btcPrice, mstrPrice, beta);

  const mstrPos = width > 0 ? (mstrPrice - support) / width : 0.5;
  const btcWidth = btcResistance - btcSupport;
  const btcPos = btcWidth > 0 ? (btcPrice - btcSupport) / btcWidth : 0.5;
  const posDiff = Math.abs(mstrPos - btcPos);

  let alignment: MstrScalpReport['btc']['alignment'] = 'neutral';
  let btcHint = '';
  if (posDiff <= 0.2) {
    alignment = 'aligned';
    btcHint = 'BTC 与 MSTR 同步';
  } else if (posDiff >= 0.4) {
    alignment = 'diverged';
    btcHint = 'BTC/MSTR 背离';
  } else {
    btcHint = 'BTC 联动中性';
  }

  const mapDiffSupport = Math.abs(mappedSupport - support);
  const mapDiffResistance = Math.abs(mappedResistance - resistance);
  if (mapDiffSupport > 1.5 || mapDiffResistance > 1.5) {
    alignment = alignment === 'aligned' ? 'neutral' : 'diverged';
    btcHint += '；映射偏差大';
  }

  const gate = evaluateGate({
    session,
    suitable,
    suitableReason,
    inRangePct,
    width,
    targetMove,
    actionSide: action.side,
    netExpectedMove,
    alignment,
    positionPct,
  });

  const score = computeScore(inRangePct, width, targetMove, suitable, alignment, session, gate.tradeable);
  const scoreHint = gate.tradeable
    ? `可执行，扣费后约 +$${netExpectedMove.toFixed(2)}`
    : gate.reason;

  const backtest =
    opts?.skipBacktest || mstrCandles.length < bars * 3
      ? null
      : backtestScalp(mstrCandles, btcCandles, window);

  const notes = [
    suitableReason,
    `ses ${session} · ${window} ${interval}`,
    `fee ~$${roundTripUsd.toFixed(2)} · net +$${netExpectedMove.toFixed(2)}`,
    gate.tradeable ? 'go y' : `go n · ${gate.reason}`,
    '仅供参考',
  ];

  return {
    window,
    interval,
    mstrSource,
    btcSource,
    mstrPrice: roundPrice(mstrPrice),
    targetMove,
    session,
    sessionHint: sessHint,
    range: {
      support,
      resistance,
      mid,
      width,
      positionPct,
      atr: roundPrice(atr),
      inRangePct,
      suitable,
      suitableReason,
    },
    levels,
    action,
    fees: {
      roundTripUsd: roundPrice(roundTripUsd),
      netExpectedMove,
    },
    gate,
    btc: {
      price: btcPrice,
      support: btcSupport,
      resistance: btcResistance,
      beta,
      mappedSupport,
      mappedResistance,
      alignment,
      hint: btcHint,
    },
    score,
    scoreHint,
    backtest,
    notes,
    refreshedAt: Date.now(),
  };
}

export async function fetchMstrScalpReport(window: ScalpWindow = '1h'): Promise<MstrScalpReport> {
  const { interval, bars } = windowConfig(window);
  const limit = Math.min(Math.max(bars * 8, 480), 1500);
  const [mstrSeries, btcSeries] = await Promise.all([
    fetchMstrCandles(interval, limit),
    fetchBtcCandles(interval, limit),
  ]);
  return analyzeMstrScalp(
    mstrSeries.candles,
    btcSeries.candles,
    window,
    interval,
    mstrSeries.source,
    btcSeries.source
  );
}
