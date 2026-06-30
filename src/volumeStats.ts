import * as http from 'http';
import * as https from 'https';

export type VolumeStatsMarketType = 'stock' | 'ashare' | 'crypto';

export interface VolumeStats {
  /** 最近 5 个完整交易日日均成交量 */
  avg5: number;
  /** 最近 20 个完整交易日日均成交量 */
  avg20: number;
  /** 最近一个交易日成交量（用于与均量对比） */
  latestVolume: number;
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      })
      .on('error', reject);
  });
}

function eastMoneySecId(type: VolumeStatsMarketType, symbol: string): string {
  if (type === 'stock') {
    return `105.${symbol.toUpperCase()}`;
  }
  const lower = symbol.toLowerCase();
  const digits = lower.replace(/^(sh|sz|bj)/, '');
  if (lower.startsWith('sh')) {
    return `1.${digits}`;
  }
  return `0.${digits}`;
}

function parseKlineVolumes(klines: string[]): number[] {
  return klines
    .map((line) => {
      const parts = line.split(',');
      const volume = parseFloat(parts[5] ?? '');
      return Number.isFinite(volume) && volume > 0 ? volume : 0;
    })
    .filter((v) => v > 0);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** 从东财日 K 线拉取历史成交量，计算 5/20 日均量（不含最近一日，避免盘中不完整数据干扰基准） */
async function fetchStockVolumeStats(type: 'stock' | 'ashare', symbol: string): Promise<VolumeStats | undefined> {
  const secid = eastMoneySecId(type, symbol);
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}` +
    '&klt=101&fqt=1&lmt=22&end=20500101' +
    '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13' +
    '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';

  const body = await httpGet(url);
  const json = JSON.parse(body) as { data?: { klines?: string[] } };
  const klines = json.data?.klines;
  if (!klines || klines.length < 6) {
    return undefined;
  }

  const volumes = parseKlineVolumes(klines);
  if (volumes.length < 6) {
    return undefined;
  }

  const latestVolume = volumes[volumes.length - 1];
  const history = volumes.slice(0, -1);
  const avg5 = average(history.slice(-5));
  const avg20 = average(history.slice(-20));

  if (avg5 <= 0 || avg20 <= 0) {
    return undefined;
  }

  return { avg5, avg20, latestVolume };
}

/** 从 Binance 日 K 线拉取历史成交量，计算 5/20 日均量 */
async function fetchCryptoVolumeStats(symbol: string): Promise<VolumeStats | undefined> {
  const url =
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol.toUpperCase())}` +
    '&interval=1d&limit=22';

  const body = await httpGet(url);
  const klines = JSON.parse(body) as Array<[number, string, string, string, string, string, number, string, ...unknown[]]>;
  if (!Array.isArray(klines) || klines.length < 6) {
    return undefined;
  }

  const volumes = klines
    .map((bar) => parseFloat(bar[5]))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (volumes.length < 6) {
    return undefined;
  }

  const latestVolume = volumes[volumes.length - 1];
  const history = volumes.slice(0, -1);
  const avg5 = average(history.slice(-5));
  const avg20 = average(history.slice(-20));

  if (avg5 <= 0 || avg20 <= 0) {
    return undefined;
  }

  return { avg5, avg20, latestVolume };
}

export async function fetchVolumeStats(type: VolumeStatsMarketType, symbol: string): Promise<VolumeStats | undefined> {
  if (type === 'crypto') {
    return fetchCryptoVolumeStats(symbol);
  }
  if (type === 'stock' || type === 'ashare') {
    return fetchStockVolumeStats(type, symbol);
  }
  return undefined;
}

export function volumeCompareLabel(ratio: number): string {
  if (ratio >= 1.5) {
    return '明显放量';
  }
  if (ratio >= 1.2) {
    return '放量';
  }
  if (ratio <= 0.5) {
    return '明显缩量';
  }
  if (ratio <= 0.8) {
    return '缩量';
  }
  return '平量';
}

export function formatVolumeRatio(current: number, average: number): string | undefined {
  if (current <= 0 || average <= 0) {
    return undefined;
  }
  const ratio = current / average;
  const pct = (ratio - 1) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${(ratio * 100).toFixed(0)}% (${sign}${pct.toFixed(0)}%，${volumeCompareLabel(ratio)})`;
}
