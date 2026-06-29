"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AMBIGUOUS_BARE_CODES = void 0;
exports.normalizeAShareCode = normalizeAShareCode;
exports.isAmbiguousBareCode = isAmbiguousBareCode;
exports.codeFromEastMoneyQuoteId = codeFromEastMoneyQuoteId;
exports.fetchAShareQuote = fetchAShareQuote;
exports.aShareDisplayLabel = aShareDisplayLabel;
exports.isAShareCodeInput = isAShareCodeInput;
exports.searchAShare = searchAShare;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const iconv = __importStar(require("iconv-lite"));
function httpGetBuffer(url, headers) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client
            .get(url, { headers }, (res) => {
            const chunks = [];
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
function normalizeAShareCode(input) {
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
exports.AMBIGUOUS_BARE_CODES = {
    '000001': [
        { code: 'sh000001', name: '上证指数' },
        { code: 'sz000001', name: '平安银行' },
    ],
};
function isAmbiguousBareCode(input) {
    const raw = input.trim().toLowerCase();
    if (/^(sh|sz|bj)\d{6}$/.test(raw)) {
        return false;
    }
    if (/^\d{6}$/.test(raw)) {
        return raw in exports.AMBIGUOUS_BARE_CODES;
    }
    return false;
}
/** 东方财富 QuoteID：1.xxxxxx=上交所，0.xxxxxx=深交所 */
function codeFromEastMoneyQuoteId(quoteId, code) {
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
function parseNumber(value) {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
}
function calcChangePercent(price, previousClose) {
    if (!previousClose) {
        return 0;
    }
    return ((price - previousClose) / previousClose) * 100;
}
/** 新浪财经 A 股行情（LeekFund 同款） */
async function fetchAShareQuote(code) {
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
function aShareDisplayLabel(code, name) {
    if (name) {
        return name;
    }
    const normalized = code.toLowerCase();
    if (/^(sh|sz|bj)\d{6}$/.test(normalized)) {
        return normalized.slice(2);
    }
    return code;
}
function isAShareCodeInput(input) {
    const raw = input.trim().toLowerCase();
    return /^(sh|sz|bj)\d{6}$/.test(raw) || /^\d{6}$/.test(raw);
}
/** 东方财富 A 股搜索，支持中文名称、拼音、代码 */
async function searchAShare(keyword) {
    const trimmed = keyword.trim();
    if (!trimmed) {
        return [];
    }
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(trimmed)}&type=14&count=20`;
    const buffer = await httpGetBuffer(url, {
        Referer: 'https://www.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0',
    });
    const json = JSON.parse(buffer.toString('utf8'));
    const rows = json.QuotationCodeTable?.Data ?? [];
    const seen = new Set();
    const results = [];
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
        }
        catch {
            // skip invalid codes
        }
    }
    return results;
}
//# sourceMappingURL=aShareSources.js.map