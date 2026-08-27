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

/** 额外滑点（单边） */
const SLIPPAGE = 0.00015;
/**
 * 维持保证金率（保证金率 = 权益/仓位名义）。
 * 币安多数 U 本位约 0.5%；只有保证金率 ≤ 此值才强平。
 * 网格通常不满仓，实际很难轻易碰到。
 */
const MAINT_MARGIN_RATE = 0.005;

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
 * 合约网格回测：
 * - 中性 / 做多偏多 / 做空偏空
 * - 单边手续费 + 少量滑点
 * - 强平按「保证金率 = 权益/仓位名义 ≤ 维持保证金率」（不满仓很难强平）
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
  const notionalBudget = investment * leverage;
  const perGridUsdt = notionalBudget / gridCount;
  const fee = feeRate + SLIPPAGE;

  if (candles.length < 2 || investment <= 0 || levels.length < 2) {
    return emptyBacktest(candles.length, investment);
  }

  const startPrice = candles[0].close;
  const gridHeld: boolean[] = Array(gridCount).fill(false);
  const entryPrice: number[] = Array(gridCount).fill(0);
  const gridQty: number[] = Array(gridCount).fill(0);

  // wallet：保证金账户；realized：已实现盈亏累计
  let wallet = investment;
  let realized = 0;

  const minLongGrids =
    direction === 'long' ? Math.max(1, Math.floor(gridCount * 0.25)) : 0;

  const openLongGrids = (): number => {
    let n = 0;
    for (let i = 0; i < gridCount; i++) {
      if (gridHeld[i] && gridQty[i] > 0) n++;
    }
    return n;
  };

  const positionNotional = (price: number): number => {
    let q = 0;
    for (let i = 0; i < gridCount; i++) {
      if (gridHeld[i]) q += Math.abs(gridQty[i]);
    }
    return q * price;
  };

  const unrealizedPnl = (price: number): number => {
    let u = 0;
    for (let i = 0; i < gridCount; i++) {
      if (!gridHeld[i] || gridQty[i] === 0) continue;
      if (gridQty[i] > 0) {
        u += gridQty[i] * (price - entryPrice[i]);
      } else {
        // 空头 qty 存负数
        u += Math.abs(gridQty[i]) * (entryPrice[i] - price);
      }
    }
    return u;
  };

  const markEquity = (price: number): number => wallet + realized + unrealizedPnl(price);

  const usedSlots = (): number => gridHeld.filter(Boolean).length;

  // 最多同时占用的格数受杠杆约束：每格占用 investment/gridCount 的保证金
  const marginPerGrid = investment / gridCount;

  const canOpen = (): boolean => {
    // 已用保证金 ≈ 持仓格数 * marginPerGrid
    return usedSlots() * marginPerGrid < investment * 0.98;
  };

  // 初始建仓
  if (direction === 'short') {
    for (let i = 0; i < gridCount; i++) {
      if (levels[i + 1] > startPrice && canOpen()) {
        const px = levels[i + 1] * (1 - SLIPPAGE);
        const qty = (perGridUsdt / px) * (1 - fee);
        const openFee = perGridUsdt * fee;
        realized -= openFee;
        gridHeld[i] = true;
        entryPrice[i] = px;
        gridQty[i] = -qty; // 空
      }
    }
  } else {
    for (let i = 0; i < gridCount; i++) {
      const shouldBuy =
        levels[i] < startPrice ||
        (direction === 'long' && levels[i] <= startPrice * 1.002);
      if (shouldBuy && canOpen()) {
        const px = levels[i] * (1 + SLIPPAGE);
        const qty = (perGridUsdt / px) * (1 - fee);
        const openFee = perGridUsdt * fee;
        realized -= openFee;
        gridHeld[i] = true;
        entryPrice[i] = px;
        gridQty[i] = qty;
      }
    }
  }

  let trades = 0;
  let peakEquity = investment;
  let maxDd = 0;
  let stopped: GridStopReason = 'none';

  const flattenAll = (price: number): void => {
    for (let i = 0; i < gridCount; i++) {
      if (!gridHeld[i] || gridQty[i] === 0) continue;
      const q = gridQty[i];
      if (q > 0) {
        const pnl = q * (price - entryPrice[i]);
        const closeFee = q * price * fee;
        realized += pnl - closeFee;
      } else {
        const aq = Math.abs(q);
        const pnl = aq * (entryPrice[i] - price);
        const closeFee = aq * price * fee;
        realized += pnl - closeFee;
      }
      gridHeld[i] = false;
      entryPrice[i] = 0;
      gridQty[i] = 0;
    }
  };

  for (let ci = 1; ci < candles.length; ci++) {
    const low = candles[ci].low;
    const high = candles[ci].high;
    const close = candles[ci].close;

    if (stopLoss != null && close <= stopLoss) {
      flattenAll(close);
      stopped = 'stopLoss';
      break;
    }
    if (takeProfit != null && close >= takeProfit) {
      flattenAll(close);
      stopped = 'takeProfit';
      break;
    }

    // 币安风格：保证金率 = 权益 / 仓位名义价值；≤ 维持保证金率才强平
    {
      const posN = positionNotional(close);
      if (posN > 0) {
        const eq = markEquity(close);
        const marginRatio = eq / posN;
        // 只有几乎亏光保证金时才强平（网格不满仓时，要很大逆行才触发）
        if (eq <= 0 || marginRatio <= MAINT_MARGIN_RATE) {
          flattenAll(close);
          // 强平后剩余权益按当前结算；若已为负则归零
          const left = Math.max(0, wallet + realized);
          wallet = left;
          realized = 0;
          stopped = 'liquidated';
          const eqNow = wallet;
          peakEquity = Math.max(peakEquity, investment, eqNow);
          maxDd = Math.max(maxDd, peakEquity > 0 ? (peakEquity - eqNow) / peakEquity : 0);
          break;
        }
      }
    }

    if (direction === 'short') {
      for (let g = 0; g < gridCount; g++) {
        const buyPrice = levels[g];
        const sellPrice = levels[g + 1];
        if (!gridHeld[g] && high >= sellPrice && canOpen()) {
          const px = sellPrice * (1 - SLIPPAGE);
          const qty = (perGridUsdt / px) * (1 - fee);
          realized -= perGridUsdt * fee;
          gridHeld[g] = true;
          entryPrice[g] = px;
          gridQty[g] = -qty;
          trades++;
        }
        if (gridHeld[g] && gridQty[g] < 0 && low <= buyPrice) {
          const px = buyPrice * (1 + SLIPPAGE);
          const aq = Math.abs(gridQty[g]);
          const pnl = aq * (entryPrice[g] - px);
          const closeFee = aq * px * fee;
          realized += pnl - closeFee;
          gridHeld[g] = false;
          entryPrice[g] = 0;
          gridQty[g] = 0;
          trades++;
        }
      }
    } else {
      for (let g = 0; g < gridCount; g++) {
        const buyPrice = levels[g];
        const sellPrice = levels[g + 1];
        if (!gridHeld[g] && low <= buyPrice && canOpen()) {
          const px = buyPrice * (1 + SLIPPAGE);
          const qty = (perGridUsdt / px) * (1 - fee);
          realized -= perGridUsdt * fee;
          gridHeld[g] = true;
          entryPrice[g] = px;
          gridQty[g] = qty;
          trades++;
        }
        if (gridHeld[g] && gridQty[g] > 0 && high >= sellPrice) {
          if (direction === 'long' && openLongGrids() <= minLongGrids) {
            continue;
          }
          const px = sellPrice * (1 - SLIPPAGE);
          const q = gridQty[g];
          const pnl = q * (px - entryPrice[g]);
          const closeFee = q * px * fee;
          realized += pnl - closeFee;
          gridHeld[g] = false;
          entryPrice[g] = 0;
          gridQty[g] = 0;
          trades++;
        }
      }
    }

    const equity = markEquity(close);
    peakEquity = Math.max(peakEquity, equity);
    if (peakEquity > 0) {
      maxDd = Math.max(maxDd, Math.max(0, (peakEquity - equity) / peakEquity));
    }
  }

  const finalEquity =
    stopped === 'liquidated'
      ? Math.max(0, wallet + realized)
      : Math.max(0, markEquity(candles[candles.length - 1].close));
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
    w.push(`杠杆 ${p.leverage}x 偏高，逆行过大仍可能强平，建议先用 3～5x`);
  }
  if (bt.stopped === 'liquidated') {
    w.push('回测中触及维持保证金率而强平（网格不满仓时较少见）');
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
