import type { Candle, ChartInterval } from './chartData';
import { fetchFuturesKlinesRange, fetchMstrCandles, fetchMstrLivePrice } from './chartData';

export type GridType = 'arithmetic' | 'geometric';
export type GridDirection = 'neutral' | 'long' | 'short';

/** 币安网格风格参数（用户可改） */
export interface BinanceGridParams {
  symbol: string;
  direction: GridDirection;
  lower: number;
  upper: number;
  gridCount: number;
  gridType: GridType;
  /** 投入保证金 USDT */
  investment: number;
  /** 杠杆 */
  leverage: number;
  /** 单边手续费，默认 0.0004 */
  feeRate: number;
  /** 可选止损价 */
  stopLoss?: number;
  /** 可选止盈价 */
  takeProfit?: number;
  /** 回测天数 */
  days: number;
  /** 扫参时最大可接受回撤%（用户设，默认 20） */
  maxDdPct?: number;
}

export interface GridSimResult {
  params: BinanceGridParams;
  currentPrice: number;
  profitPerGridPct: number;
  perGridUsdt: number;
  levels: number[];
  oscillation: {
    inRangePct: number;
    closeBreakouts: number;
    suitable: boolean;
    reason: string;
  };
  backtest: {
    candleCount: number;
    interval: ChartInterval;
    tradeCount: number;
    netProfitUsdt: number;
    netRoiPct: number;
    maxDrawdownPct: number;
    finalEquity: number;
    stopped: 'none' | 'stopLoss' | 'takeProfit';
  };
  binanceHint: string[];
  /** 扫参时附带的备选 */
  alternatives?: Array<{
    lower: number;
    upper: number;
    gridCount: number;
    gridType: GridType;
    netRoiPct: number;
    maxDrawdownPct: number;
    tradeCount: number;
    score: number;
  }>;
  optimizeMeta?: {
    tried: number;
    passed: number;
  };
  refreshedAt: number;
}

const DEFAULT_PARAMS: BinanceGridParams = {
  symbol: 'MSTRUSDT',
  direction: 'neutral',
  lower: 123,
  upper: 127,
  gridCount: 30,
  gridType: 'arithmetic',
  investment: 1000,
  leverage: 3,
  feeRate: 0.0004,
  days: 5,
  maxDdPct: 20,
};

export function defaultGridParams(): BinanceGridParams {
  return { ...DEFAULT_PARAMS };
}

export function buildGridLevels(
  lower: number,
  upper: number,
  gridCount: number,
  gridType: GridType
): number[] {
  if (lower >= upper || gridCount < 1) {
    return [];
  }
  const levels: number[] = [];
  if (gridType === 'arithmetic') {
    for (let i = 0; i <= gridCount; i++) {
      levels.push(lower + ((upper - lower) * i) / gridCount);
    }
  } else {
    const step = (upper / lower) ** (1 / gridCount);
    for (let i = 0; i <= gridCount; i++) {
      levels.push(lower * step ** i);
    }
  }
  return levels;
}

export function profitPerGridPct(
  lower: number,
  upper: number,
  gridCount: number,
  gridType: GridType
): number {
  if (gridCount < 1) {
    return 0;
  }
  if (gridType === 'arithmetic') {
    const step = (upper - lower) / gridCount;
    const mid = (lower + upper) / 2;
    return mid > 0 ? step / mid : 0;
  }
  return (upper / lower) ** (1 / gridCount) - 1;
}

function roundPrice(price: number): number {
  if (price >= 100) {
    return Math.round(price * 100) / 100;
  }
  if (price >= 1) {
    return Math.round(price * 1000) / 1000;
  }
  return Math.round(price * 10000) / 10000;
}

function checkOscillation(candles: Candle[], lower: number, upper: number) {
  const closes = candles.map((c) => c.close).filter(Number.isFinite);
  let inRange = 0;
  let breakouts = 0;
  for (const c of closes) {
    if (c >= lower && c <= upper) {
      inRange++;
    } else {
      breakouts++;
    }
  }
  const inRangePct = closes.length > 0 ? (inRange / closes.length) * 100 : 0;
  let suitable = false;
  let reason = '';
  if (inRangePct >= 65) {
    suitable = true;
    reason = `${inRangePct.toFixed(0)}% 在区间内，较适合网格`;
  } else if (inRangePct < 50) {
    suitable = false;
    reason = `仅 ${inRangePct.toFixed(0)}% 在区间内，偏趋势，网格易失效`;
  } else {
    suitable = true;
    reason = `区间内 ${inRangePct.toFixed(0)}%，可小资金试运行`;
  }
  return { inRangePct, closeBreakouts: breakouts, suitable, reason };
}

/**
 * 中性网格回测（对齐币安现货/中性合约网格思路）：
 * 每格固定名义 USDT，下穿买入、上穿卖出；杠杆仅放大名义仓位（简化，不含强平）。
 */
export function backtestNeutralGrid(
  candles: Candle[],
  params: BinanceGridParams
): GridSimResult['backtest'] {
  const { lower, upper, gridCount, gridType, investment, leverage, feeRate } = params;
  const stopLoss = params.stopLoss;
  const takeProfit = params.takeProfit;
  const levels = buildGridLevels(lower, upper, gridCount, gridType);
  const notional = investment * Math.max(1, leverage);
  const perGridUsdt = notional / gridCount;

  if (candles.length < 2 || investment <= 0 || levels.length < 2) {
    return {
      candleCount: candles.length,
      interval: '5m',
      tradeCount: 0,
      netProfitUsdt: 0,
      netRoiPct: 0,
      maxDrawdownPct: 0,
      finalEquity: investment,
      stopped: 'none',
    };
  }

  let cash = notional;
  let coins = 0;
  const startPrice = candles[0].close;
  const gridHeld: boolean[] = Array(gridCount).fill(false);

  for (let i = 0; i < gridCount; i++) {
    if (levels[i] < startPrice && cash >= perGridUsdt) {
      const qty = (perGridUsdt / levels[i]) * (1 - feeRate);
      coins += qty;
      cash -= perGridUsdt;
      gridHeld[i] = true;
    }
  }

  let trades = 0;
  let peakEquity = investment;
  let maxDd = 0;
  let stopped: 'none' | 'stopLoss' | 'takeProfit' = 'none';

  for (let ci = 1; ci < candles.length; ci++) {
    const low = candles[ci].low;
    const high = candles[ci].high;
    const close = candles[ci].close;

    if (stopLoss != null && close <= stopLoss) {
      // 强平式：按市价清仓
      cash += coins * close * (1 - feeRate);
      coins = 0;
      stopped = 'stopLoss';
      break;
    }
    if (takeProfit != null && close >= takeProfit) {
      cash += coins * close * (1 - feeRate);
      coins = 0;
      stopped = 'takeProfit';
      break;
    }

    for (let g = 0; g < gridCount; g++) {
      const buyPrice = levels[g];
      const sellPrice = levels[g + 1];
      if (!gridHeld[g] && low <= buyPrice && cash >= perGridUsdt) {
        const qty = (perGridUsdt / buyPrice) * (1 - feeRate);
        coins += qty;
        cash -= perGridUsdt;
        gridHeld[g] = true;
        trades++;
      }
      if (gridHeld[g] && high >= sellPrice) {
        const sellQty = perGridUsdt / buyPrice;
        if (coins >= sellQty) {
          cash += sellQty * sellPrice * (1 - feeRate);
          coins -= sellQty;
          gridHeld[g] = false;
          trades++;
        }
      }
    }

    // 权益按保证金视角：名义仓位盈亏折回 investment
    const notionalEquity = cash + coins * close;
    const equity = investment + (notionalEquity - notional);
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity > 0) {
      maxDd = Math.max(maxDd, (peakEquity - equity) / peakEquity);
    }
  }

  const last = candles[candles.length - 1].close;
  const finalNotional = cash + coins * last;
  const finalEquity = investment + (finalNotional - notional);
  const netProfitUsdt = finalEquity - investment;
  const netRoiPct = investment > 0 ? (netProfitUsdt / investment) * 100 : 0;

  return {
    candleCount: candles.length,
    interval: '5m',
    tradeCount: trades,
    netProfitUsdt: Math.round(netProfitUsdt * 100) / 100,
    netRoiPct: Math.round(netRoiPct * 100) / 100,
    maxDrawdownPct: Math.round(maxDd * 10000) / 100,
    finalEquity: Math.round(finalEquity * 100) / 100,
    stopped,
  };
}

/** 根据近期 K 线自动估上下限 */
export async function suggestGridRange(days = 3): Promise<{ lower: number; upper: number; price: number }> {
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  const candles = await fetchFuturesKlinesRange('MSTRUSDT', '5m', start, end, 2000);
  if (candles.length < 10) {
    const series = await fetchMstrCandles('5m', 200);
    const slice = series.candles;
    const lo = Math.min(...slice.map((c) => c.low));
    const hi = Math.max(...slice.map((c) => c.high));
    return {
      lower: roundPrice(lo * 0.998),
      upper: roundPrice(hi * 1.002),
      price: slice[slice.length - 1].close,
    };
  }
  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  return {
    lower: roundPrice(lo * 0.998),
    upper: roundPrice(hi * 1.002),
    price: candles[candles.length - 1].close,
  };
}

export async function runBinanceGridSim(params: BinanceGridParams): Promise<GridSimResult> {
  const p: BinanceGridParams = {
    ...params,
    symbol: (params.symbol || 'MSTRUSDT').toUpperCase(),
    lower: Number(params.lower),
    upper: Number(params.upper),
    gridCount: Math.max(2, Math.min(150, Math.floor(Number(params.gridCount) || 30))),
    investment: Math.max(10, Number(params.investment) || 1000),
    leverage: Math.max(1, Math.min(20, Number(params.leverage) || 1)),
    feeRate: Math.max(0, Number(params.feeRate) || 0.0004),
    days: Math.max(1, Math.min(30, Math.floor(Number(params.days) || 5))),
  };

  if (!(p.lower < p.upper)) {
    throw new Error('下限必须小于上限');
  }

  const end = Date.now();
  const start = end - p.days * 24 * 60 * 60 * 1000;
  const candles = await fetchFuturesKlinesRange(p.symbol, '5m', start, end, 5000);
  if (candles.length < 20) {
    throw new Error('历史 K 线不足，请稍后重试');
  }

  let currentPrice = candles[candles.length - 1].close;
  try {
    currentPrice = await fetchMstrLivePrice();
  } catch {
    // keep last close
  }

  const levels = buildGridLevels(p.lower, p.upper, p.gridCount, p.gridType);
  const ppg = profitPerGridPct(p.lower, p.upper, p.gridCount, p.gridType);
  const notional = p.investment * p.leverage;
  const oscillation = checkOscillation(candles, p.lower, p.upper);
  const backtest = backtestNeutralGrid(candles, p);
  backtest.interval = '5m';

  const feeRoundTrip = p.feeRate * 2;
  const binanceHint = [
    `币安可填: 下限 ${p.lower} / 上限 ${p.upper} / ${p.gridCount}格 / ${p.gridType === 'arithmetic' ? '等差' : '等比'}`,
    `投入 ${p.investment}U · ${p.leverage}x · 方向 ${p.direction}`,
    `每格约 ${(ppg * 100).toFixed(3)}%，往返费约 ${(feeRoundTrip * 100).toFixed(2)}%`,
    ppg > feeRoundTrip * 2
      ? '每格利润覆盖手续费，尚可'
      : '每格偏薄，建议减格数或加宽区间',
    oscillation.reason,
  ];

  return {
    params: p,
    currentPrice: roundPrice(currentPrice),
    profitPerGridPct: ppg,
    perGridUsdt: Math.round((notional / p.gridCount) * 100) / 100,
    levels: levels.map(roundPrice),
    oscillation,
    backtest,
    binanceHint,
    refreshedAt: Date.now(),
  };
}

function scoreGridResult(bt: GridSimResult['backtest'], ppg: number, feeRate: number): number {
  const feeOk = ppg >= feeRate * 2 ? 2 : -5;
  const tradeFactor = Math.min(bt.tradeCount / 30, 1) * 3;
  return bt.netRoiPct - bt.maxDrawdownPct * 0.5 + tradeFactor + feeOk;
}

/**
 * 自动扫参：用户固定 投入/杠杆/费率/天数/方向/最大回撤；
 * 自动搜索 区间 × 网格数 × 等差/等比，返回最优并写回参数。
 */
export async function optimizeBinanceGrid(
  base: BinanceGridParams
): Promise<GridSimResult> {
  const p0: BinanceGridParams = {
    ...defaultGridParams(),
    ...base,
    symbol: (base.symbol || 'MSTRUSDT').toUpperCase(),
    investment: Math.max(10, Number(base.investment) || 1000),
    leverage: Math.max(1, Math.min(20, Number(base.leverage) || 1)),
    feeRate: Math.max(0, Number(base.feeRate) || 0.0004),
    days: Math.max(1, Math.min(30, Math.floor(Number(base.days) || 5))),
    maxDdPct: Math.max(1, Math.min(80, Number(base.maxDdPct) || 20)),
  };

  const end = Date.now();
  const start = end - p0.days * 24 * 60 * 60 * 1000;
  const candles = await fetchFuturesKlinesRange(p0.symbol, '5m', start, end, 5000);
  if (candles.length < 20) {
    throw new Error('历史 K 线不足，请稍后重试');
  }

  const rawLo = Math.min(...candles.map((c) => c.low));
  const rawHi = Math.max(...candles.map((c) => c.high));
  const mid = (rawLo + rawHi) / 2;
  const half = (rawHi - rawLo) / 2;

  // 区间候选：全区间 / 收窄 / 略放宽 / 以中轴对称
  const rangeScales = [1.0, 0.9, 0.8, 0.7, 1.05];
  const ranges: Array<{ lower: number; upper: number }> = [];
  for (const s of rangeScales) {
    const lower = roundPrice(mid - half * s);
    const upper = roundPrice(mid + half * s);
    if (lower < upper) {
      ranges.push({ lower, upper });
    }
  }
  // 再加：近期 50% 分位更紧的区间（去掉极端高低）
  const sorted = [...candles].map((c) => c.close).sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  if (p10 < p90) {
    ranges.push({ lower: roundPrice(p10), upper: roundPrice(p90) });
  }

  const counts = [15, 20, 25, 30, 35, 40, 50, 60];
  const types: GridType[] = ['arithmetic', 'geometric'];
  const maxDd = p0.maxDdPct ?? 20;

  type Cand = {
    lower: number;
    upper: number;
    gridCount: number;
    gridType: GridType;
    netRoiPct: number;
    maxDrawdownPct: number;
    tradeCount: number;
    score: number;
    bt: GridSimResult['backtest'];
    ppg: number;
  };

  const passed: Cand[] = [];
  let tried = 0;

  for (const range of ranges) {
    for (const gridCount of counts) {
      for (const gridType of types) {
        tried++;
        const trial: BinanceGridParams = {
          ...p0,
          lower: range.lower,
          upper: range.upper,
          gridCount,
          gridType,
        };
        const ppg = profitPerGridPct(range.lower, range.upper, gridCount, gridType);
        // 每格利润需至少盖住约 2 倍单边费
        if (ppg < p0.feeRate * 1.8) {
          continue;
        }
        const bt = backtestNeutralGrid(candles, trial);
        bt.interval = '5m';
        if (bt.maxDrawdownPct > maxDd) {
          continue;
        }
        if (bt.tradeCount < 4) {
          continue;
        }
        const score = scoreGridResult(bt, ppg, p0.feeRate);
        passed.push({
          lower: range.lower,
          upper: range.upper,
          gridCount,
          gridType,
          netRoiPct: bt.netRoiPct,
          maxDrawdownPct: bt.maxDrawdownPct,
          tradeCount: bt.tradeCount,
          score,
          bt,
          ppg,
        });
      }
    }
  }

  if (passed.length === 0) {
    throw new Error(`扫参无结果：放宽 maxDd（现 ${maxDd}%）或增加天数后再试`);
  }

  passed.sort((a, b) => b.score - a.score);
  const best = passed[0];
  const alternatives = passed.slice(1, 4).map((c) => ({
    lower: c.lower,
    upper: c.upper,
    gridCount: c.gridCount,
    gridType: c.gridType,
    netRoiPct: c.netRoiPct,
    maxDrawdownPct: c.maxDrawdownPct,
    tradeCount: c.tradeCount,
    score: Math.round(c.score * 100) / 100,
  }));

  const bestParams: BinanceGridParams = {
    ...p0,
    lower: best.lower,
    upper: best.upper,
    gridCount: best.gridCount,
    gridType: best.gridType,
  };

  let currentPrice = candles[candles.length - 1].close;
  try {
    currentPrice = await fetchMstrLivePrice();
  } catch {
    // keep
  }

  const levels = buildGridLevels(best.lower, best.upper, best.gridCount, best.gridType);
  const notional = bestParams.investment * bestParams.leverage;
  const oscillation = checkOscillation(candles, best.lower, best.upper);
  const feeRoundTrip = bestParams.feeRate * 2;

  return {
    params: bestParams,
    currentPrice: roundPrice(currentPrice),
    profitPerGridPct: best.ppg,
    perGridUsdt: Math.round((notional / best.gridCount) * 100) / 100,
    levels: levels.map(roundPrice),
    oscillation,
    backtest: best.bt,
    binanceHint: [
      `最优: lo ${best.lower} hi ${best.upper} n=${best.gridCount} ${best.gridType === 'arithmetic' ? '等差' : '等比'}`,
      `试了 ${tried} 组，通过 ${passed.length} 组（maxDd≤${maxDd}%）`,
      `每格 ${(best.ppg * 100).toFixed(3)}% · 往返费 ${(feeRoundTrip * 100).toFixed(2)}%`,
      oscillation.reason,
      '最优基于历史回测，实盘请小资金验证',
    ],
    alternatives,
    optimizeMeta: { tried, passed: passed.length },
    refreshedAt: Date.now(),
  };
}
