import type { Candle, ChartInterval } from './chartData';
import { fetchFuturesKlinesRange, fetchMstrCandles, fetchMstrLivePrice } from './chartData';

export type GridType = 'arithmetic' | 'geometric';
export type GridDirection = 'neutral' | 'long' | 'short';
export type GridStopReason = 'none' | 'stopLoss' | 'takeProfit' | 'liquidated';

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
    stopped: GridStopReason;
  };
  warnings: string[];
  binanceHint: string[];
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

/** 额外滑点（单边），让回测更接近实盘 */
const SLIPPAGE = 0.0002;
/** 维持保证金率近似：权益低于名义仓位×此值视为强平 */
const MAINT_RATE = 0.004;

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

function emptyBacktest(candleCount: number, investment: number): GridSimResult['backtest'] {
  return {
    candleCount,
    interval: '5m',
    tradeCount: 0,
    netProfitUsdt: 0,
    netRoiPct: 0,
    maxDrawdownPct: 0,
    finalEquity: investment,
    stopped: 'none',
  };
}

/**
 * 合约网格回测（更严）：
 * - 中性 / 做多偏多 / 做空偏空
 * - 单边手续费 + 滑点
 * - 简易强平（权益过低清零）
 * - 用户止损/止盈价
 */
export function backtestFuturesGrid(
  candles: Candle[],
  params: BinanceGridParams
): GridSimResult['backtest'] {
  const direction = params.direction || 'neutral';
  const { lower, upper, gridCount, gridType, investment, feeRate } = params;
  const leverage = Math.max(1, Math.min(20, params.leverage || 1));
  const stopLoss = params.stopLoss;
  const takeProfit = params.takeProfit;
  const levels = buildGridLevels(lower, upper, gridCount, gridType);
  const notional = investment * leverage;
  const perGridUsdt = notional / gridCount;
  const fee = feeRate + SLIPPAGE;

  if (candles.length < 2 || investment <= 0 || levels.length < 2) {
    return emptyBacktest(candles.length, investment);
  }

  const startPrice = candles[0].close;
  // gridHeld[g]=true 表示该格有仓：多=持有现货/多仓，空=持有空仓
  const gridHeld: boolean[] = Array(gridCount).fill(false);
  // 每格开仓均价（用于空头平仓）
  const entryPrice: number[] = Array(gridCount).fill(0);

  let cash = notional; // 可用名义资金
  let longQty = 0; // 多头币数
  let shortQty = 0; // 空头币数
  let shortEntryNotional = 0; // 空头开仓名义合计（qty*entry）

  const minLongGrids =
    direction === 'long' ? Math.max(1, Math.floor(gridCount * 0.25)) : 0;

  // 初始建仓
  if (direction === 'short') {
    for (let i = 0; i < gridCount; i++) {
      if (levels[i + 1] > startPrice && cash >= perGridUsdt) {
        const px = levels[i + 1] * (1 - SLIPPAGE);
        const qty = (perGridUsdt / px) * (1 - fee);
        shortQty += qty;
        shortEntryNotional += qty * px;
        cash -= perGridUsdt;
        gridHeld[i] = true;
        entryPrice[i] = px;
      }
    }
  } else {
    // 中性/做多：现价以下买入；做多再多建一些靠近现价的仓
    for (let i = 0; i < gridCount; i++) {
      const shouldBuy =
        levels[i] < startPrice ||
        (direction === 'long' && levels[i] <= startPrice * 1.002);
      if (shouldBuy && cash >= perGridUsdt) {
        const px = levels[i] * (1 + SLIPPAGE);
        const qty = (perGridUsdt / px) * (1 - fee);
        longQty += qty;
        cash -= perGridUsdt;
        gridHeld[i] = true;
        entryPrice[i] = px;
      }
    }
  }

  let trades = 0;
  let peakEquity = investment;
  let maxDd = 0;
  let stopped: GridStopReason = 'none';

  const markEquity = (price: number): number => {
    const longValue = longQty * price;
    const shortPnl = shortQty > 0 ? shortEntryNotional - shortQty * price : 0;
    const book = cash + longValue + shortPnl;
    return investment + (book - notional);
  };

  const heldCount = () => gridHeld.filter(Boolean).length;

  for (let ci = 1; ci < candles.length; ci++) {
    const low = candles[ci].low;
    const high = candles[ci].high;
    const close = candles[ci].close;

    // 用户止损/止盈（按收盘）
    if (stopLoss != null && close <= stopLoss) {
      const eq = markEquity(close);
      cash = notional + (eq - investment);
      longQty = 0;
      shortQty = 0;
      shortEntryNotional = 0;
      gridHeld.fill(false);
      stopped = 'stopLoss';
      break;
    }
    if (takeProfit != null && close >= takeProfit) {
      const eq = markEquity(close);
      cash = notional + (eq - investment);
      longQty = 0;
      shortQty = 0;
      shortEntryNotional = 0;
      gridHeld.fill(false);
      stopped = 'takeProfit';
      break;
    }

    // 简易强平：权益过低 或 低于维持保证金近似
    {
      const eq = markEquity(close);
      const posNotional = longQty * close + shortQty * close;
      const maint = posNotional * MAINT_RATE;
      if (eq <= Math.max(investment * 0.02, maint) || eq <= 0) {
        cash = 0;
        longQty = 0;
        shortQty = 0;
        shortEntryNotional = 0;
        gridHeld.fill(false);
        stopped = 'liquidated';
        // 强平后权益记 0
        peakEquity = Math.max(peakEquity, investment);
        maxDd = Math.max(maxDd, 1);
        break;
      }
    }

    if (direction === 'short') {
      // 空头网格：涨到卖价开空，跌到买价平空
      for (let g = 0; g < gridCount; g++) {
        const buyPrice = levels[g];
        const sellPrice = levels[g + 1];
        if (!gridHeld[g] && high >= sellPrice && cash >= perGridUsdt) {
          const px = sellPrice * (1 - SLIPPAGE);
          const qty = (perGridUsdt / px) * (1 - fee);
          shortQty += qty;
          shortEntryNotional += qty * px;
          cash -= perGridUsdt;
          gridHeld[g] = true;
          entryPrice[g] = px;
          trades++;
        }
        if (gridHeld[g] && low <= buyPrice) {
          const px = buyPrice * (1 + SLIPPAGE);
          const qty = perGridUsdt / entryPrice[g];
          if (shortQty >= qty * 0.99) {
            const pnl = qty * (entryPrice[g] - px);
            cash += perGridUsdt + pnl;
            cash -= qty * px * fee; // 平仓费
            shortQty -= qty;
            shortEntryNotional -= qty * entryPrice[g];
            if (shortEntryNotional < 0) shortEntryNotional = 0;
            gridHeld[g] = false;
            entryPrice[g] = 0;
            trades++;
          }
        }
      }
    } else {
      // 中性 / 做多：跌买涨卖；做多保留底仓
      for (let g = 0; g < gridCount; g++) {
        const buyPrice = levels[g];
        const sellPrice = levels[g + 1];
        if (!gridHeld[g] && low <= buyPrice && cash >= perGridUsdt) {
          const px = buyPrice * (1 + SLIPPAGE);
          const qty = (perGridUsdt / px) * (1 - fee);
          longQty += qty;
          cash -= perGridUsdt;
          gridHeld[g] = true;
          entryPrice[g] = px;
          trades++;
        }
        if (gridHeld[g] && high >= sellPrice) {
          if (direction === 'long' && heldCount() <= minLongGrids) {
            continue; // 做多保留底仓不卖光
          }
          const px = sellPrice * (1 - SLIPPAGE);
          const qty = perGridUsdt / entryPrice[g];
          if (longQty >= qty * 0.99) {
            cash += qty * px * (1 - fee);
            longQty -= qty;
            gridHeld[g] = false;
            entryPrice[g] = 0;
            trades++;
          }
        }
      }
    }

    const equity = markEquity(close);
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity > 0) {
      maxDd = Math.max(maxDd, (peakEquity - equity) / peakEquity);
    }
  }

  let finalEquity: number;
  if (stopped === 'liquidated') {
    finalEquity = 0;
  } else {
    finalEquity = markEquity(candles[candles.length - 1].close);
  }
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

/** @deprecated 兼容旧名 */
export const backtestNeutralGrid = backtestFuturesGrid;

function buildWarnings(p: BinanceGridParams, bt: GridSimResult['backtest'], inRangePct: number): string[] {
  const w: string[] = [];
  if (p.leverage >= 10) {
    w.push(`杠杆 ${p.leverage}x 偏高，回测已含强平，实盘风险极大`);
  }
  if (bt.stopped === 'liquidated') {
    w.push('回测中触发强平，期末按归零计');
  }
  if (bt.maxDrawdownPct >= 40) {
    w.push(`最大回撤 ${bt.maxDrawdownPct.toFixed(1)}% 过高，不建议照搬`);
  }
  if (inRangePct < 55) {
    w.push('价格常在区间外，网格环境偏差');
  }
  if (p.days <= 3 && bt.netRoiPct > p.days * 8) {
    w.push('短周期收益率偏夸张，仅供参考，勿当实盘预期');
  }
  return w;
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
    direction: params.direction || 'neutral',
    lower: Number(params.lower),
    upper: Number(params.upper),
    gridCount: Math.max(2, Math.min(150, Math.floor(Number(params.gridCount) || 30))),
    investment: Math.max(10, Number(params.investment) || 1000),
    leverage: Math.max(1, Math.min(20, Number(params.leverage) || 1)),
    feeRate: Math.max(0, Number(params.feeRate) || 0.0004),
    days: Math.max(1, Math.min(30, Math.floor(Number(params.days) || 5))),
    maxDdPct: params.maxDdPct,
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
  const backtest = backtestFuturesGrid(candles, p);
  backtest.interval = '5m';
  const warnings = buildWarnings(p, backtest, oscillation.inRangePct);

  const feeRoundTrip = (p.feeRate + SLIPPAGE) * 2;
  const binanceHint = [
    `币安可填: 下限 ${p.lower} / 上限 ${p.upper} / ${p.gridCount}格 / ${p.gridType === 'arithmetic' ? '等差' : '等比'} / ${p.direction}`,
    `投入 ${p.investment}U · ${p.leverage}x`,
    `每格约 ${(ppg * 100).toFixed(3)}%，往返成本约 ${(feeRoundTrip * 100).toFixed(2)}%（含滑点）`,
    ppg > feeRoundTrip * 1.5
      ? '每格利润尚可覆盖成本'
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
    warnings,
    binanceHint,
    refreshedAt: Date.now(),
  };
}

function scoreGridResult(
  bt: GridSimResult['backtest'],
  ppg: number,
  feeRate: number,
  days: number
): number {
  if (bt.stopped === 'liquidated') {
    return -999;
  }
  const feeOk = ppg >= (feeRate + SLIPPAGE) * 2 ? 2 : -8;
  const tradeFactor = Math.min(bt.tradeCount / 40, 1) * 2;
  // 重罚回撤；抑制短周期暴利刷分
  const roiCap = Math.min(bt.netRoiPct, days * 6);
  return roiCap - bt.maxDrawdownPct * 1.25 + tradeFactor + feeOk;
}

/**
 * 自动扫参：用户固定 投入/杠杆/费率/天数/方向/最大回撤；
 * 自动搜索 区间 × 网格数 × 等差/等比。
 * 硬性过滤：回撤、强平、区间占比、短周期暴利。
 */
export async function optimizeBinanceGrid(base: BinanceGridParams): Promise<GridSimResult> {
  const p0: BinanceGridParams = {
    ...defaultGridParams(),
    ...base,
    symbol: (base.symbol || 'MSTRUSDT').toUpperCase(),
    direction: base.direction || 'neutral',
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

  const rangeScales = [1.0, 0.9, 0.8, 0.7, 1.05];
  const ranges: Array<{ lower: number; upper: number }> = [];
  for (const s of rangeScales) {
    const lower = roundPrice(mid - half * s);
    const upper = roundPrice(mid + half * s);
    if (lower < upper) {
      ranges.push({ lower, upper });
    }
  }
  const sorted = [...candles].map((c) => c.close).sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  if (p10 < p90) {
    ranges.push({ lower: roundPrice(p10), upper: roundPrice(p90) });
  }

  const counts = [15, 20, 25, 30, 35, 40, 50];
  const types: GridType[] = ['arithmetic', 'geometric'];
  const maxDd = p0.maxDdPct ?? 20;
  const maxRoi = p0.days * 10; // 每天超过约 10% 视为不可信，过滤

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
    inRangePct: number;
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
        if (ppg < (p0.feeRate + SLIPPAGE) * 2) {
          continue;
        }
        const osc = checkOscillation(candles, range.lower, range.upper);
        if (osc.inRangePct < 55) {
          continue;
        }
        const bt = backtestFuturesGrid(candles, trial);
        bt.interval = '5m';
        if (bt.stopped === 'liquidated') {
          continue;
        }
        if (bt.maxDrawdownPct > maxDd + 1e-6) {
          continue;
        }
        if (bt.tradeCount < 6) {
          continue;
        }
        if (bt.netRoiPct > maxRoi) {
          continue;
        }
        if (bt.netRoiPct < -maxDd) {
          continue;
        }
        const score = scoreGridResult(bt, ppg, p0.feeRate, p0.days);
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
          inRangePct: osc.inRangePct,
        });
      }
    }
  }

  if (passed.length === 0) {
    throw new Error(
      `扫参无结果：可放宽最大回撤（现 ${maxDd}%）、降低杠杆，或增加天数后再试`
    );
  }

  passed.sort((a, b) => b.score - a.score);
  const best = passed[0];
  // 二次确认不超回撤
  if (best.maxDrawdownPct > maxDd) {
    throw new Error('扫参内部错误：最优回撤超限');
  }

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
  const feeRoundTrip = (bestParams.feeRate + SLIPPAGE) * 2;
  const warnings = buildWarnings(bestParams, best.bt, oscillation.inRangePct);

  return {
    params: bestParams,
    currentPrice: roundPrice(currentPrice),
    profitPerGridPct: best.ppg,
    perGridUsdt: Math.round((notional / best.gridCount) * 100) / 100,
    levels: levels.map(roundPrice),
    oscillation,
    backtest: best.bt,
    warnings,
    binanceHint: [
      `最优: 下限 ${best.lower} 上限 ${best.upper} 格数 ${best.gridCount} ${best.gridType === 'arithmetic' ? '等差' : '等比'}`,
      `试了 ${tried} 组，通过 ${passed.length} 组（回撤≤${maxDd}% 且未强平）`,
      `每格 ${(best.ppg * 100).toFixed(3)}% · 往返成本约 ${(feeRoundTrip * 100).toFixed(2)}%`,
      oscillation.reason,
      '已过滤强平/超回撤/短周期暴利，仍非实盘保证',
    ],
    alternatives,
    optimizeMeta: { tried, passed: passed.length },
    refreshedAt: Date.now(),
  };
}
