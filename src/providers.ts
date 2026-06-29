import * as https from 'https';

export interface QuoteData {
  symbol: string;
  price: number;
  changePercent: number;
  previousClose: number;
  high: number;
  low: number;
  open: number;
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

/** Finnhub quote API - same approach as US Stock Bar */
export async function fetchStockQuote(symbol: string, apiKey: string): Promise<QuoteData> {
  if (!apiKey) {
    throw new Error('请配置 kanpan.finnhubApiKey');
  }

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  const body = await httpGet(url);
  const json = JSON.parse(body) as {
    c: number;
    dp: number;
    h: number;
    l: number;
    o: number;
    pc: number;
  };

  if (json.c === 0 && json.pc === 0) {
    throw new Error(`无 ${symbol} 数据，请检查代码是否正确`);
  }

  return {
    symbol,
    price: json.c,
    changePercent: json.dp ?? 0,
    previousClose: json.pc,
    high: json.h,
    low: json.l,
    open: json.o,
  };
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
  };

  return {
    symbol,
    price: parseFloat(json.lastPrice),
    changePercent: parseFloat(json.priceChangePercent),
    previousClose: parseFloat(json.prevClosePrice || json.openPrice),
    high: parseFloat(json.highPrice),
    low: parseFloat(json.lowPrice),
    open: parseFloat(json.openPrice),
  };
}

export function defaultSymbolLabel(symbol: string): string {
  if (symbol.endsWith('USDT')) {
    return symbol.replace('USDT', '');
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

export function renderFormat(
  template: string,
  symbol: string,
  price: number,
  changePercent: number,
  showIcon: boolean
): string {
  const icon = showIcon ? (changePercent >= 0 ? '$(arrow-up)' : '$(arrow-down)') : '';
  return template
    .replace(/\{symbol\}/g, symbol)
    .replace(/\{price\}/g, formatPrice(price))
    .replace(/\{change\}/g, formatChangePercent(changePercent))
    .replace(/\{icon\}/g, icon)
    .replace(/\s+/g, ' ')
    .trim();
}
