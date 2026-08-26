import * as https from 'https';

export type ChartInterval = '1m' | '5m' | '15m' | '1h';

export interface Candle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ChartSeries {
  candles: Candle[];
  source: string;
  interval: ChartInterval;
}

async function httpGet(url: string, timeoutMs = 30000): Promise<string> {
  if (typeof fetch === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

function binanceInterval(interval: ChartInterval): string {
  return interval;
}

function parseBinanceKlines(body: string): Candle[] {
  const rows = JSON.parse(body) as Array<[number, string, string, string, string, string, ...unknown[]]>;
  return rows
    .map((r) => ({
      t: r[0],
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
      volume: parseFloat(r[5]),
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite));
}

async function fetchBinanceSpotKlines(
  symbol: string,
  interval: ChartInterval,
  limit: number
): Promise<Candle[]> {
  const upper = encodeURIComponent(symbol.toUpperCase());
  const iv = binanceInterval(interval);
  const path = `/api/v3/klines?symbol=${upper}&interval=${iv}&limit=${limit}`;
  const urls = [`https://data-api.binance.vision${path}`, `https://api.binance.com${path}`];
  let lastError: unknown;
  for (const url of urls) {
    try {
      const candles = parseBinanceKlines(await httpGet(url));
      if (candles.length >= 2) {
        return candles;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法获取 Binance 现货 K 线');
}

async function fetchBinanceFuturesKlines(
  symbol: string,
  interval: ChartInterval,
  limit: number
): Promise<Candle[]> {
  const upper = encodeURIComponent(symbol.toUpperCase());
  const iv = binanceInterval(interval);
  const path = `/fapi/v1/klines?symbol=${upper}&interval=${iv}&limit=${limit}`;
  const bases = [
    'https://fapi.binance.com',
    'https://fapi1.binance.com',
    'https://fapi2.binance.com',
    'https://fapi3.binance.com',
  ];
  let lastError: unknown;
  for (const base of bases) {
    try {
      const candles = parseBinanceKlines(await httpGet(`${base}${path}`));
      if (candles.length >= 2) {
        return candles;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法获取 Binance 合约 K 线');
}

/** MSTR USDT 永续合约 K 线（MSTRUSDT） */
export async function fetchMstrCandles(interval: ChartInterval, limit: number): Promise<ChartSeries> {
  const candles = await fetchBinanceFuturesKlines('MSTRUSDT', interval, limit);
  return { candles, source: 'Binance MSTRUSDT 合约', interval };
}

export async function fetchBtcCandles(interval: ChartInterval, limit: number): Promise<ChartSeries> {
  const candles = await fetchBinanceSpotKlines('BTCUSDT', interval, limit);
  return { candles, source: `Binance BTC ${interval}`, interval };
}
