import type { Candle } from './chartData';
import { fetchBtcCandles, fetchMstrCandles, type ChartInterval } from './chartData';

export type ScalpWindow = '1h' | '2h' | '4h';

const GRID_STEP = 0.5;
const ENTRY_TOLERANCE = 0.15;

export interface MstrScalpReport {
  window: ScalpWindow;
  interval: ChartInterval;
  mstrSource: string;
  btcSource: string;
  mstrPrice: number;
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
  grids: number[];
  action: {
    side: 'long' | 'short' | 'neutral';
    entryZone: [number, number];
    takeProfit: number;
    stopLoss: number;
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

function roundHalf(price: number): number {
  return Math.round(price * 2) / 2;
}

function buildGrids(support: number, resistance: number, step = GRID_STEP): number[] {
  const start = Math.floor(support / step) * step;
  const grids: number[] = [];
  for (let p = start; p <= resistance + step * 0.01; p += step) {
    grids.push(roundHalf(p));
  }
  return grids;
}

function inRangeStats(candles: Candle[], lower: number, upper: number): { inRangePct: number; breakouts: number } {
  const closes = candles.map((c) => c.close).filter(Number.isFinite);
  let inRange = 0;
  let breakouts = 0;
  for (const close of closes) {
    if (close >= lower && close <= upper) {
      inRange++;
    } else {
      breakouts++;
    }
  }
  return {
    inRangePct: closes.length > 0 ? (inRange / closes.length) * 100 : 0,
    breakouts,
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
  return roundHalf(mstrAnchor * (1 + btcMovePct * beta));
}

function deriveAction(
  price: number,
  support: number,
  resistance: number,
  positionPct: number,
  grids: number[]
): MstrScalpReport['action'] {
  const below = grids.filter((g) => g <= price);
  const above = grids.filter((g) => g >= price);
  const nearestBelow = below.length > 0 ? below[below.length - 1] : roundHalf(support);
  const nearestAbove = above.length > 0 ? above[0] : roundHalf(resistance);
  const distBelow = price - nearestBelow;
  const distAbove = nearestAbove - price;

  if (distBelow <= ENTRY_TOLERANCE && positionPct <= 45) {
    const tp = roundHalf(nearestBelow + GRID_STEP);
    return {
      side: 'long',
      entryZone: [roundHalf(nearestBelow - ENTRY_TOLERANCE), roundHalf(nearestBelow + ENTRY_TOLERANCE)],
      takeProfit: tp,
      stopLoss: roundHalf(support - GRID_STEP),
      hint: `接近 ${nearestBelow.toFixed(1)} 支撑格，做多参考，目标 +$${GRID_STEP} → $${tp.toFixed(1)}`,
    };
  }
  if (distAbove <= ENTRY_TOLERANCE && positionPct >= 55) {
    const tp = roundHalf(nearestAbove - GRID_STEP);
    return {
      side: 'short',
      entryZone: [roundHalf(nearestAbove - ENTRY_TOLERANCE), roundHalf(nearestAbove + ENTRY_TOLERANCE)],
      takeProfit: tp,
      stopLoss: roundHalf(resistance + GRID_STEP),
      hint: `接近 ${nearestAbove.toFixed(1)} 压力格，做空参考，目标 -$${GRID_STEP} → $${tp.toFixed(1)}`,
    };
  }
  if (positionPct < 35) {
    const tp = roundHalf(nearestBelow + GRID_STEP);
    return {
      side: 'long',
      entryZone: [roundHalf(support), roundHalf(support + 0.3)],
      takeProfit: tp,
      stopLoss: roundHalf(support - GRID_STEP),
      hint: `偏区间下沿 (${positionPct.toFixed(0)}%)，可考虑低吸，目标 $${tp.toFixed(1)}`,
    };
  }
  if (positionPct > 65) {
    const tp = roundHalf(nearestAbove - GRID_STEP);
    return {
      side: 'short',
      entryZone: [roundHalf(resistance - 0.3), roundHalf(resistance)],
      takeProfit: tp,
      stopLoss: roundHalf(resistance + GRID_STEP),
      hint: `偏区间上沿 (${positionPct.toFixed(0)}%)，可考虑高抛，目标 $${tp.toFixed(1)}`,
    };
  }
  return {
    side: 'neutral',
    entryZone: [roundHalf(price - 0.2), roundHalf(price + 0.2)],
    takeProfit: roundHalf(price + GRID_STEP),
    stopLoss: roundHalf(support - GRID_STEP),
    hint: '区间中部，等待靠近支撑/压力格再操作',
  };
}

function computeScore(inRangePct: number, width: number, suitable: boolean, alignment: string): number {
  let score = 50;
  if (inRangePct >= 70) {
    score += 25;
  } else if (inRangePct >= 55) {
    score += 15;
  } else if (inRangePct < 45) {
    score -= 20;
  }
  if (width >= 1 && width <= 4) {
    score += 15;
  } else if (width < 1) {
    score -= 15;
  } else if (width > 6) {
    score -= 10;
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
  const support = roundHalf(Math.max(rawSupport - buffer, rawSupport * 0.998));
  const resistance = roundHalf(rawResistance + buffer);
  const mstrPrice = mstrSlice.at(-1)?.close ?? support;
  const mid = roundHalf((support + resistance) / 2);
  const width = roundHalf(resistance - support);
  const positionPct =
    width > 0 ? Math.max(0, Math.min(100, ((mstrPrice - support) / width) * 100)) : 50;

  const { inRangePct } = inRangeStats(mstrSlice, support, resistance);
  let suitable = false;
  let suitableReason = '';
  if (inRangePct >= 65 && width >= 1) {
    suitable = true;
    suitableReason = `${inRangePct.toFixed(0)}% 时间在区间内，宽度 $${width.toFixed(1)}，适合 +$0.5 震荡`;
  } else if (width < 1) {
    suitable = false;
    suitableReason = `区间仅 $${width.toFixed(1)}，+$0.5 空间有限`;
  } else if (inRangePct < 50) {
    suitable = false;
    suitableReason = `仅 ${inRangePct.toFixed(0)}% 在区间内，偏趋势`;
  } else {
    suitable = true;
    suitableReason = `震荡中等，可小仓试探`;
  }

  const grids = buildGrids(support, resistance);
  const action = deriveAction(mstrPrice, support, resistance, positionPct, grids);

  const btcLows = btcSlice.map((c) => c.low);
  const btcHighs = btcSlice.map((c) => c.high);
  const btcAtr = computeAtr(btcSlice);
  const btcSupport = btcSlice.length > 0 ? Math.min(...btcLows) - btcAtr * 0.3 : 0;
  const btcResistance = btcSlice.length > 0 ? Math.max(...btcHighs) + btcAtr * 0.3 : 0;
  const btcPrice = btcSlice.at(-1)?.close ?? 0;
  const beta = computeShortBeta(mstrSlice, btcSlice);
  const mappedSupport = mapBtcLevelToMstr(btcSupport, btcPrice, mstrPrice, beta);
  const mappedResistance = mapBtcLevelToMstr(btcResistance, btcPrice, mstrPrice, beta);

  const mstrMid = (support + resistance) / 2;
  const btcMid = (btcSupport + btcResistance) / 2;
  const mstrPos = width > 0 ? (mstrPrice - support) / width : 0.5;
  const btcWidth = btcResistance - btcSupport;
  const btcPos = btcWidth > 0 ? (btcPrice - btcSupport) / btcWidth : 0.5;
  const posDiff = Math.abs(mstrPos - btcPos);

  let alignment: 'aligned' | 'diverged' | 'neutral' = 'neutral';
  let btcHint = '';
  if (posDiff <= 0.2) {
    alignment = 'aligned';
    btcHint = 'BTC 与 MSTR 位置同步，参考较可靠';
  } else if (posDiff >= 0.4) {
    alignment = 'diverged';
    btcHint = 'BTC/MSTR 位置背离，谨慎参考映射价位';
  } else {
    btcHint = 'BTC 联动中性';
  }

  const mapDiffSupport = Math.abs(mappedSupport - support);
  const mapDiffResistance = Math.abs(mappedResistance - resistance);
  if (mapDiffSupport > 1.5 || mapDiffResistance > 1.5) {
    alignment = alignment === 'aligned' ? 'neutral' : 'diverged';
    btcHint += '；映射区间与 K 线区间偏差较大';
  }

  const score = computeScore(inRangePct, width, suitable, alignment);
  const scoreHint =
    score >= 75
      ? '震荡清晰，适合频繁 +$0.5'
      : score >= 55
        ? '可操作，注意止损'
        : '环境一般，建议观望或缩小仓位';

  const notes = [
    suitableReason,
    `近 ${window} · ${interval} K · ${mstrSlice.length} 根`,
    `每格 $${GRID_STEP}，共 ${grids.length} 格`,
    `BTC Beta(短)=${beta.toFixed(2)}`,
    `BTC 区间 $${btcSupport.toFixed(0)} ~ $${btcResistance.toFixed(0)}`,
    '仅供参考，不构成投资建议',
  ];

  return {
    window,
    interval,
    mstrSource,
    btcSource,
    mstrPrice: roundHalf(mstrPrice),
    range: {
      support,
      resistance,
      mid,
      width,
      positionPct,
      atr: roundHalf(atr),
      inRangePct,
      suitable,
      suitableReason,
    },
    grids,
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
