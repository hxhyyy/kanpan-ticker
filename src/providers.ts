import * as https from 'https';
import { MarketSession } from './session';

export interface QuoteData {
  symbol: string;
  price: number;
  changePercent: number;
  previousClose: number;
  high: number;
  low: number;
  open: number;
  /** 成交量（股/币数量） */
  volume?: number;
  /** 最近一个完整交易日成交量（用于盘前/盘后对比均量） */
  latestVolume?: number;
  /** 成交额（USD/USDT 等计价货币） */
  quoteVolume?: number;
  /** 5 个交易日日均成交量（不含当日） */
  avgVolume5?: number;
  /** 20 个交易日日均成交量（不含当日） */
  avgVolume20?: number;
  dataSource?: string;
  session?: MarketSession;
  name?: string;
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }
          resolve(data);
        });
      })
      .on('error', reject);
  });
}

const CRYPTO_DISPLAY_NAMES: Record<string, string> = {
  BTCUSDT: 'Bitcoin',
  ETHUSDT: 'Ethereum',
  BNBUSDT: 'BNB',
  SOLUSDT: 'Solana',
  XRPUSDT: 'XRP',
  DOGEUSDT: 'Dogecoin',
};

function cryptoDisplayName(symbol: string): string {
  const upper = symbol.toUpperCase();
  return CRYPTO_DISPLAY_NAMES[upper] ?? upper.replace(/USDT$|BUSD$|USD$/, '');
}

export type BinanceMarket = 'spot' | 'futures';

export interface BinanceTradingPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  market: BinanceMarket;
}

const BINANCE_PAIRS_TTL_MS = 60 * 60 * 1000;
let binancePairsCache: { pairs: BinanceTradingPair[]; fetchedAt: number } | undefined;

function sortBinancePairs(pairs: BinanceTradingPair[]): BinanceTradingPair[] {
  return pairs.sort((a, b) => {
    // 现货优先于合约；USDT 优先；再按符号排序
    const aMarket = a.market === 'spot' ? 0 : 1;
    const bMarket = b.market === 'spot' ? 0 : 1;
    if (aMarket !== bMarket) {
      return aMarket - bMarket;
    }
    const aUsdt = a.quoteAsset === 'USDT' ? 0 : 1;
    const bUsdt = b.quoteAsset === 'USDT' ? 0 : 1;
    if (aUsdt !== bUsdt) {
      return aUsdt - bUsdt;
    }
    return a.symbol.localeCompare(b.symbol);
  });
}

async function fetchSpotTradingPairs(): Promise<BinanceTradingPair[]> {
  const body = await httpGet('https://api.binance.com/api/v3/exchangeInfo');
  const json = JSON.parse(body) as {
    symbols: Array<{
      symbol: string;
      status: string;
      baseAsset: string;
      quoteAsset: string;
    }>;
  };

  return json.symbols
    .filter((s) => s.status === 'TRADING')
    .map((s) => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      market: 'spot' as const,
    }));
}

async function fetchFuturesTradingPairs(): Promise<BinanceTradingPair[]> {
  const body = await httpGet('https://fapi.binance.com/fapi/v1/exchangeInfo');
  const json = JSON.parse(body) as {
    symbols: Array<{
      symbol: string;
      status: string;
      baseAsset: string;
      quoteAsset: string;
    }>;
  };

  return json.symbols
    .filter((s) => s.status === 'TRADING')
    .map((s) => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      market: 'futures' as const,
    }));
}

/** 拉取 Binance 现货 + 合约 TRADING 交易对（现货优先；同名只保留现货；缓存 1 小时） */
export async function fetchBinanceTradingPairs(): Promise<BinanceTradingPair[]> {
  const now = Date.now();
  if (binancePairsCache && now - binancePairsCache.fetchedAt < BINANCE_PAIRS_TTL_MS) {
    return binancePairsCache.pairs;
  }

  const [spot, futures] = await Promise.all([fetchSpotTradingPairs(), fetchFuturesTradingPairs()]);
  const bySymbol = new Map<string, BinanceTradingPair>();
  for (const pair of spot) {
    bySymbol.set(pair.symbol, pair);
  }
  for (const pair of futures) {
    if (!bySymbol.has(pair.symbol)) {
      bySymbol.set(pair.symbol, pair);
    }
  }

  const pairs = sortBinancePairs([...bySymbol.values()]);
  binancePairsCache = { pairs, fetchedAt: now };
  return pairs;
}

type BinanceTickerJson = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  prevClosePrice?: string;
  volume: string;
  quoteVolume: string;
};

function quoteFromTicker(upper: string, json: BinanceTickerJson, dataSource: string): QuoteData {
  return {
    symbol: upper,
    name: cryptoDisplayName(upper),
    price: parseFloat(json.lastPrice),
    changePercent: parseFloat(json.priceChangePercent),
    previousClose: parseFloat(json.prevClosePrice || json.openPrice),
    high: parseFloat(json.highPrice),
    low: parseFloat(json.lowPrice),
    open: parseFloat(json.openPrice),
    volume: parseFloat(json.volume),
    quoteVolume: parseFloat(json.quoteVolume),
    dataSource,
  };
}

async function fetchSpotCryptoQuote(upper: string): Promise<QuoteData> {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(upper)}`;
  const body = await httpGet(url);
  return quoteFromTicker(upper, JSON.parse(body) as BinanceTickerJson, 'Binance');
}

async function fetchFuturesCryptoQuote(upper: string): Promise<QuoteData> {
  const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(upper)}`;
  const body = await httpGet(url);
  return quoteFromTicker(upper, JSON.parse(body) as BinanceTickerJson, 'Binance Futures');
}

/** Binance 24hr ticker：先现货，失败再试 U 本位合约（如 STRCUSDT） */
export async function fetchCryptoQuote(symbol: string): Promise<QuoteData> {
  const upper = symbol.toUpperCase();
  try {
    return await fetchSpotCryptoQuote(upper);
  } catch (spotError) {
    try {
      return await fetchFuturesCryptoQuote(upper);
    } catch {
      throw spotError instanceof Error ? spotError : new Error(String(spotError));
    }
  }
}

export function defaultSymbolLabel(symbol: string): string {
  if (symbol.endsWith('USDT')) {
    return symbol.replace('USDT', '');
  }
  const lower = symbol.toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(lower)) {
    return lower.slice(2);
  }
  return symbol;
}

export function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toFixed(2);
  }
  return price.toFixed(4);
}

export function formatChangePercent(changePercent: number): string {
  const sign = changePercent >= 0 ? '+' : '';
  return `${sign}${changePercent.toFixed(2)}%`;
}

/** 格式化大数字成交量/成交额，如 1.23B、456.7M */
export function formatVolume(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return '-';
  }
  if (value >= 1e9) {
    return `${(value / 1e9).toFixed(2)}B`;
  }
  if (value >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  }
  if (value >= 1e3) {
    return `${(value / 1e3).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

export function formatVolumeDetail(quote: QuoteData): string | undefined {
  if (quote.volume === undefined || quote.volume <= 0) {
    return undefined;
  }
  if (quote.dataSource === '新浪财经') {
    const wanShou = quote.volume / 10000;
    if (wanShou >= 1) {
      return `量: ${wanShou.toFixed(2)}万手`;
    }
    return `量: ${quote.volume.toFixed(0)}手`;
  }
  return `量: ${formatVolume(quote.volume)}`;
}

export function renderFormat(
  template: string,
  symbol: string,
  price: number,
  changePercent: number,
  showIcon: boolean,
  volumeText?: string
): string {
  const icon = showIcon ? (changePercent >= 0 ? '$(arrow-up)' : '$(arrow-down)') : '';
  return template
    .replace(/\{symbol\}/g, symbol)
    .replace(/\{price\}/g, formatPrice(price))
    .replace(/\{change\}/g, formatChangePercent(changePercent))
    .replace(/\{volume\}/g, volumeText ?? '-')
    .replace(/\{icon\}/g, icon)
    .replace(/\s+/g, ' ')
    .trim();
}
