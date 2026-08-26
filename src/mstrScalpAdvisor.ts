import type { Candle } from './chartData';
import { fetchBtcCandles, fetchMstrCandles, type ChartInterval } from './chartData';

export type ScalpWindow = '1h' | '2h' | '4h';

/** 单次操作至少值得赚的价差（美元） */
const MIN_PROFIT = 0.4;

export interface MstrScalpReport {
  window: ScalpWindow;
  interval: ChartInterval;
  mstrSource: string;
  btcSource: string;
  mstrPrice: number;
  /** 本次窗口建议的单趟目标价差 */
  targetMove: number;
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
  /** 按 targetMove 切分的参考价位 */
  levels: number[];
  action: {
    side: 'long' | 'short' | 'neutral';
    entryZone: [number, number];
    takeProfit: number;
    stopLoss: number;
    expectedMove: number;
    hint: string;
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

/**
 * 根据近几小时波动，估算「这一趟值得做」的目标价差。
 * 不低于 MIN_PROFIT，也不超过区间宽度的 45%。
 */
export function computeTargetMove(candles: Candle[], width: number, atr: number): number {
  const med = medianBarRange(candles);
  let step = Math.max(MIN_PROFIT, med * 1.4, atr * 0.55);
  if (width > 0) {
    step = Math.min(step, width * 0.45);
  }
  step = Math.min(step, 2.5);
  return roundPrice(Math.max(step, MIN_PROFIT));
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
      hint: `近下沿，做多参考，目标 +$${longMove.toFixed(2)}`,
    };
  }
  if (distHigh <= entryTol && positionPct >= 55 && shortMove >= MIN_PROFIT) {
    return {
      side: 'short',
      entryZone: [roundPrice(anchorHigh - entryTol), roundPrice(anchorHigh + entryTol)],
      takeProfit: shortTp,
      stopLoss: roundPrice(resistance + stopPad),
      expectedMove: roundPrice(shortMove),
      hint: `近上沿，做空参考，目标 -$${shortMove.toFixed(2)}`,
    };
  }
  if (positionPct < 35 && longMove >= MIN_PROFIT) {
    return {
      side: 'long',
      entryZone: [roundPrice(support), roundPrice(support + entryTol)],
      takeProfit: longTp,
      stopLoss: roundPrice(support - stopPad),
      expectedMove: roundPrice(longMove),
      hint: `偏下 (${positionPct.toFixed(0)}%)，低吸参考 +$${longMove.toFixed(2)}`,
    };
  }
  if (positionPct > 65 && shortMove >= MIN_PROFIT) {
    return {
      side: 'short',
      entryZone: [roundPrice(resistance - entryTol), roundPrice(resistance)],
      takeProfit: shortTp,
      stopLoss: roundPrice(resistance + stopPad),
      expectedMove: roundPrice(shortMove),
      hint: `偏上 (${positionPct.toFixed(0)}%)，高抛参考 -$${shortMove.toFixed(2)}`,
    };
  }

  const waitMove = positionPct <= 50 ? longMove : shortMove;
  return {
    side: 'neutral',
    entryZone: [roundPrice(price - entryTol), roundPrice(price + entryTol)],
    takeProfit: positionPct <= 50 ? longTp : shortTp,
    stopLoss: roundPrice(support - stopPad),
    expectedMove: roundPrice(Math.max(waitMove, MIN_PROFIT)),
    hint: '中部，等靠近上下沿再动',
  };
}

function computeScore(
  inRangePct: number,
  width: number,
  targetMove: number,
  suitable: boolean,
  alignment: string
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
  if (targetMove >= MIN_PROFIT) {
    score += 5;
  }
  if (suitable) {
    score += 10;
  }
  if (alignment === 'aligned') {
    score += 10;
  } else if (alignment === 'diverged') {
    score -= 10;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function analyzeMstrScalp(
  mstrCandles: Candle[],
  btcCandles: Candle[],
  window: ScalpWindow,
  interval: ChartInterval,
  mstrSource: string,
  btcSource: string
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
  let suitable = false;
  let suitableReason = '';
  if (inRangePct >= 65 && width >= targetMove * 1.5) {
    suitable = true;
    suitableReason = `${inRangePct.toFixed(0)}% 在区间内，宽 $${width.toFixed(2)}，建议每趟 ≥$${targetMove.toFixed(2)}`;
  } else if (width < targetMove * 1.2) {
    suitable = false;
    suitableReason = `区间 $${width.toFixed(2)} 偏窄，难做出 ≥$${MIN_PROFIT} 空间`;
  } else if (inRangePct < 50) {
    suitable = false;
    suitableReason = `仅 ${inRangePct.toFixed(0)}% 在区间内，偏趋势`;
  } else {
    suitable = true;
    suitableReason = `震荡尚可，目标价差约 $${targetMove.toFixed(2)}`;
  }

  const action = deriveAction(mstrPrice, support, resistance, positionPct, targetMove, levels);

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

  let alignment: 'aligned' | 'diverged' | 'neutral' = 'neutral';
  let btcHint = '';
  if (posDiff <= 0.2) {
    alignment = 'aligned';
    btcHint = 'BTC 与 MSTR 位置同步';
  } else if (posDiff >= 0.4) {
    alignment = 'diverged';
    btcHint = 'BTC/MSTR 背离，映射仅供参考';
  } else {
    btcHint = 'BTC 联动中性';
  }

  const mapDiffSupport = Math.abs(mappedSupport - support);
  const mapDiffResistance = Math.abs(mappedResistance - resistance);
  if (mapDiffSupport > 1.5 || mapDiffResistance > 1.5) {
    alignment = alignment === 'aligned' ? 'neutral' : 'diverged';
    btcHint += '；映射与 K 线区间偏差大';
  }

  const score = computeScore(inRangePct, width, targetMove, suitable, alignment);
  const scoreHint =
    score >= 75
      ? `适合震荡，建议每趟 $${targetMove.toFixed(2)} 左右`
      : score >= 55
        ? '可操作，注意止损'
        : '环境一般，观望为主';

  const notes = [
    suitableReason,
    `近 ${window} · ${interval} · ${mstrSlice.length} 根`,
    `ATR $${atr.toFixed(2)} · 目标价差 $${targetMove.toFixed(2)}`,
    `BTC Beta(短)=${beta.toFixed(2)}`,
    '仅供参考',
  ];

  return {
    window,
    interval,
    mstrSource,
    btcSource,
    mstrPrice: roundPrice(mstrPrice),
    targetMove,
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
    notes,
    refreshedAt: Date.now(),
  };
}

export async function fetchMstrScalpReport(window: ScalpWindow = '1h'): Promise<MstrScalpReport> {
  const { interval, bars } = windowConfig(window);
  const limit = Math.min(Math.max(bars + 20, 80), 200);
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
