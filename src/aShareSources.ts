import * as http from 'http';
import * as https from 'https';
import * as iconv from 'iconv-lite';
import { QuoteData } from './providers';

function httpGetBuffer(url: string, headers?: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client
      .get(url, { headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      })
      .on('error', reject);
  });
}

/** 标准化 A 股代码，如 600519 → sh600519 */
export function normalizeAShareCode(input: string): string {
  const raw = input.trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(raw)) {
    return raw;
  }
  if (/^\d{6}$/.test(raw)) {
    if (raw.startsWith('6')) {
      return `sh${raw}`;
    }
    if (raw.startsWith('8') || raw.startsWith('4')) {
      return `bj${raw}`;
    }
    return `sz${raw}`;
  }
  throw new Error(`无效的 A 股代码: ${input}`);
}

/** 000001 等同码在不同交易所含义不同 */
export const AMBIGUOUS_BARE_CODES: Record<string, Array<{ code: string; name: string }>> = {
  '000001': [
    { code: 'sh000001', name: '上证指数' },
    { code: 'sz000001', name: '平安银行' },
  ],
};

export function isAmbiguousBareCode(input: string): boolean {
  const raw = input.trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(raw)) {
    return false;
  }
  if (/^\d{6}$/.test(raw)) {
    return raw in AMBIGUOUS_BARE_CODES;
  }
  return false;
}

/** 东方财富 QuoteID：1.xxxxxx=上交所，0.xxxxxx=深交所 */
export function codeFromEastMoneyQuoteId(quoteId: string | undefined, code: string): string {
  if (quoteId) {
    const dot = quoteId.indexOf('.');
    if (dot >= 0) {
      const market = quoteId.slice(0, dot);
      const digits = code.padStart(6, '0');
      if (/^\d{6}$/.test(digits)) {
        if (market === '1') {
          return `sh${digits}`;
        }
        if (market === '0') {
          if (digits.startsWith('8') || digits.startsWith('4')) {
            return `bj${digits}`;
          }
          return `sz${digits}`;
        }
      }
    }
  }
  return normalizeAShareCode(code);
}

function parseNumber(value: string): number {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}

function calcChangePercent(price: number, previousClose: number): number {
  if (!previousClose) {
    return 0;
  }
  return ((price - previousClose) / previousClose) * 100;
}

/** 新浪财经 A 股行情（LeekFund 同款） */
export async function fetchAShareQuote(code: string): Promise<QuoteData> {
  const normalized = normalizeAShareCode(code);
  const url = `https://hq.sinajs.cn/list=${normalized}`;
  const buffer = await httpGetBuffer(url, {
    Referer: 'https://finance.sina.com.cn/',
    'User-Agent': 'Mozilla/5.0',
  });
  const text = iconv.decode(buffer, 'gb18030');

  if (/FAILED/.test(text)) {
    throw new Error(`新浪无 ${normalized} 数据`);
  }

  const match = text.match(/="([^"]*)"/);
  if (!match) {
    throw new Error(`新浪 ${normalized} 响应解析失败`);
  }

  const params = match[1].split(',');
  if (params.length < 10) {
    throw new Error(`新浪 ${normalized} 字段不足`);
  }

  const name = params[0];
  const open = parseNumber(params[1]);
  const previousClose = parseNumber(params[2]);
  let price = parseNumber(params[3]);
  const high = parseNumber(params[4]);
  const low = parseNumber(params[5]);
  const volumeLots = parseNumber(params[8]);

  if (price === 0 && previousClose > 0) {
    price = previousClose;
  }
  if (!price) {
    throw new Error(`新浪 ${normalized} 价格为空（可能休市）`);
  }

  const changePercent = calcChangePercent(price, previousClose);

  return {
    symbol: normalized,
    name,
    price,
    changePercent,
    previousClose,
    high,
    low,
    open,
    volume: volumeLots,
    dataSource: '新浪财经',
    session: 'regular',
  };
}

export function aShareDisplayLabel(code: string, name?: string): string {
  if (name) {
    return name;
  }
  const normalized = code.toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(normalized)) {
    return normalized.slice(2);
  }
  return code;
}

export interface AShareSearchResult {
  code: string;
  name: string;
  typeName?: string;
}

export function isAShareCodeInput(input: string): boolean {
  const raw = input.trim().toLowerCase();
  return /^(sh|sz|bj)\d{6}$/.test(raw) || /^\d{6}$/.test(raw);
}

/** 东方财富 A 股搜索，支持中文名称、拼音、代码 */
export async function searchAShare(keyword: string): Promise<AShareSearchResult[]> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return [];
  }

  const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(trimmed)}&type=14&count=20`;
  const buffer = await httpGetBuffer(url, {
    Referer: 'https://www.eastmoney.com/',
    'User-Agent': 'Mozilla/5.0',
  });
  const json = JSON.parse(buffer.toString('utf8')) as {
    QuotationCodeTable?: {
      Data?: Array<{ Code?: string; Name?: string; QuoteID?: string; SecurityTypeName?: string }>;
    };
  };

  const rows = json.QuotationCodeTable?.Data ?? [];
  const seen = new Set<string>();
  const results: AShareSearchResult[] = [];

  for (const row of rows) {
    if (!row.Code || !row.Name) {
      continue;
    }
    try {
      const code = codeFromEastMoneyQuoteId(row.QuoteID, row.Code);
      if (seen.has(code)) {
        continue;
      }
      seen.add(code);
      results.push({ code, name: row.Name, typeName: row.SecurityTypeName });
    } catch {
      // skip invalid codes
    }
  }

  return results;
}
