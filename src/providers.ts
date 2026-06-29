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
  /** 成交额（USD/USDT 等计价货币） */
  quoteVolume?: number;
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

/** Binance 24hr ticker - same approach as CryptoTickerPlus */
export async function fetchCryptoQuote(symbol: string): Promise<QuoteData> {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  const body = await httpGet(url);
  const json = JSON.parse(body) as {
    symbol: string;
    lastPrice: string;
    priceChangePercent: string;
    openPrice: string;
    highPrice: string;
    lowPrice: string;
    prevClosePrice: string;
    volume: string;
    quoteVolume: string;
  };

  return {
    symbol,
    price: parseFloat(json.lastPrice),
    changePercent: parseFloat(json.priceChangePercent),
    previousClose: parseFloat(json.prevClosePrice || json.openPrice),
    high: parseFloat(json.highPrice),
    low: parseFloat(json.lowPrice),
    open: parseFloat(json.openPrice),
    volume: parseFloat(json.volume),
    quoteVolume: parseFloat(json.quoteVolume),
  };
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
