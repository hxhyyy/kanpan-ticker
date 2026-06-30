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
exports.STOCK_SOURCE_OPTIONS = void 0;
exports.getStockSourceLabel = getStockSourceLabel;
exports.fetchFromFinnhub = fetchFromFinnhub;
exports.fetchFromEastMoney = fetchFromEastMoney;
exports.fetchFromSina = fetchFromSina;
exports.fetchFromTencent = fetchFromTencent;
exports.fetchStockQuoteBySource = fetchStockQuoteBySource;
exports.formatQuoteTooltip = formatQuoteTooltip;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const iconv = __importStar(require("iconv-lite"));
const providers_1 = require("./providers");
const volumeStats_1 = require("./volumeStats");
const session_1 = require("./session");
exports.STOCK_SOURCE_OPTIONS = [
    {
        id: 'auto',
        label: '自动（多源回退）',
        description: '按优先级依次尝试，直到成功',
        needsApiKey: false,
    },
    {
        id: 'eastmoney',
        label: '东方财富',
        description: '免 Key，支持盘前/盘中/盘后',
        needsApiKey: false,
    },
    {
        id: 'sina',
        label: '新浪财经',
        description: '免 Key，LeekFund 同款，盘前盘后较好',
        needsApiKey: false,
    },
    {
        id: 'tencent',
        label: '腾讯财经',
        description: '免 Key，国内访问稳定',
        needsApiKey: false,
    },
    {
        id: 'finnhubExtended',
        label: 'Finnhub 盘前盘后',
        description: '需 API Key，含延长交易时段',
        needsApiKey: true,
    },
    {
        id: 'finnhub',
        label: 'Finnhub 盘中',
        description: '需 API Key，常规报价',
        needsApiKey: true,
    },
];
function getStockSourceLabel(id) {
    return exports.STOCK_SOURCE_OPTIONS.find((o) => o.id === id)?.label ?? id;
}
function httpGet(url, headers) {
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
function decodeSinaBody(buffer) {
    try {
        return iconv.decode(buffer, 'gb18030');
    }
    catch {
        return buffer.toString('utf8');
    }
}
function buildQuote(symbol, data, dataSource) {
    return { symbol, ...data, dataSource };
}
function calcChangePercent(price, previousClose) {
    if (!previousClose) {
        return 0;
    }
    return ((price - previousClose) / previousClose) * 100;
}
function parseNumber(value) {
    const num = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(num) ? num : 0;
}
function scaleEastMoneyPrice(value) {
    if (!value) {
        return 0;
    }
    return value / 100;
}
async function fetchFromFinnhub(symbol, apiKey, extended = false) {
    if (!apiKey) {
        throw new Error('请配置 kanpan.finnhubApiKey');
    }
    const tradeParam = extended ? '&trade=true' : '';
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}${tradeParam}&token=${encodeURIComponent(apiKey)}`;
    const body = (await httpGet(url)).toString('utf8');
    const json = JSON.parse(body);
    if (json.c === 0 && json.pc === 0) {
        throw new Error(`Finnhub 无 ${symbol} 数据`);
    }
    const session = (0, session_1.getUsMarketSession)();
    return buildQuote(symbol, {
        price: json.c,
        changePercent: json.dp ?? calcChangePercent(json.c, json.pc),
        previousClose: json.pc,
        high: json.h,
        low: json.l,
        open: json.o,
        session: extended ? session : session === 'regular' ? 'regular' : session,
    }, extended ? 'Finnhub 盘前盘后' : 'Finnhub');
}
async function fetchFromEastMoney(symbol) {
    const fields = 'f43,f44,f45,f46,f57,f58,f60,f169,f170,f400,f5,f6';
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=105.${encodeURIComponent(symbol)}&fields=${fields}`;
    const body = (await httpGet(url)).toString('utf8');
    const json = JSON.parse(body);
    const data = json.data;
    if (!data) {
        throw new Error(`东财无 ${symbol} 数据`);
    }
    const price = scaleEastMoneyPrice(parseNumber(data.f43));
    const previousClose = scaleEastMoneyPrice(parseNumber(data.f60));
    const open = scaleEastMoneyPrice(parseNumber(data.f46));
    const high = scaleEastMoneyPrice(parseNumber(data.f44));
    const low = scaleEastMoneyPrice(parseNumber(data.f45));
    const changePercent = scaleEastMoneyPrice(parseNumber(data.f170)) || calcChangePercent(price, previousClose);
    if (!price) {
        throw new Error(`东财 ${symbol} 价格为空`);
    }
    const sessionFlag = String(data.f400 ?? '');
    let session = (0, session_1.getUsMarketSession)();
    if (sessionFlag.includes('pre')) {
        session = 'pre';
    }
    else if (sessionFlag.includes('after')) {
        session = 'after';
    }
    else if (sessionFlag.includes('period')) {
        session = 'regular';
    }
    return buildQuote(symbol, {
        price,
        changePercent,
        previousClose,
        high,
        low,
        open,
        name: String(data.f58 ?? ''),
        session,
        volume: parseNumber(data.f5),
        quoteVolume: parseNumber(data.f6),
    }, '东方财富');
}
async function fetchFromSina(symbol) {
    const code = `usr_${symbol.toLowerCase()}`;
    const url = `https://hq.sinajs.cn/list=${code}`;
    const buffer = await httpGet(url, {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0',
    });
    const text = decodeSinaBody(buffer);
    if (/FAILED/.test(text)) {
        throw new Error(`新浪无 ${symbol} 数据`);
    }
    const match = text.match(/="([^"]*)"/);
    if (!match) {
        throw new Error(`新浪 ${symbol} 响应解析失败`);
    }
    const params = match[1].split(',');
    if (params.length < 27) {
        throw new Error(`新浪 ${symbol} 字段不足`);
    }
    const session = (0, session_1.getUsMarketSession)();
    let price = parseNumber(params[1]);
    let previousClose = parseNumber(params[26]);
    const open = parseNumber(params[5]);
    const high = parseNumber(params[6]);
    const low = parseNumber(params[7]);
    const prePrice = parseNumber(params[21]);
    const preBaseClose = parseNumber(params[35]);
    if (session === 'pre') {
        if (prePrice > 0) {
            price = prePrice;
        }
        if (preBaseClose > 0) {
            previousClose = preBaseClose;
        }
    }
    else if (session === 'after') {
        if (prePrice > 0) {
            price = prePrice;
        }
        if (parseNumber(params[1]) > 0) {
            previousClose = parseNumber(params[1]);
        }
    }
    if (!price) {
        throw new Error(`新浪 ${symbol} 价格为空`);
    }
    const changePercent = calcChangePercent(price, previousClose);
    return buildQuote(symbol, {
        price,
        changePercent,
        previousClose,
        high,
        low,
        open,
        name: params[0],
        session,
        volume: parseNumber(params[10]),
    }, '新浪财经');
}
async function fetchFromTencent(symbol) {
    const code = `us${symbol.toUpperCase()}`;
    const url = `https://qt.gtimg.cn/q=${code}`;
    const buffer = await httpGet(url, { 'User-Agent': 'Mozilla/5.0' });
    const text = decodeSinaBody(buffer);
    const match = text.match(/="([^"]*)"/);
    if (!match) {
        throw new Error(`腾讯 ${symbol} 响应解析失败`);
    }
    const params = match[1].split('~');
    if (params.length < 35) {
        throw new Error(`腾讯 ${symbol} 字段不足`);
    }
    const price = parseNumber(params[3]);
    const previousClose = parseNumber(params[4]);
    const open = parseNumber(params[5]);
    const high = parseNumber(params[33]) || parseNumber(params[41]);
    const low = parseNumber(params[34]) || parseNumber(params[42]);
    const changePercent = parseNumber(params[32]) || calcChangePercent(price, previousClose);
    if (!price) {
        throw new Error(`腾讯 ${symbol} 价格为空`);
    }
    return buildQuote(symbol, {
        price,
        changePercent,
        previousClose,
        high,
        low,
        open,
        name: params[1],
        session: (0, session_1.getUsMarketSession)(),
    }, '腾讯财经');
}
async function fetchBySource(source, symbol, apiKey) {
    switch (source) {
        case 'finnhub':
            return fetchFromFinnhub(symbol, apiKey, false);
        case 'finnhubExtended':
            return fetchFromFinnhub(symbol, apiKey, true);
        case 'eastmoney':
            return fetchFromEastMoney(symbol);
        case 'sina':
            return fetchFromSina(symbol);
        case 'tencent':
            return fetchFromTencent(symbol);
    }
}
async function fetchStockQuoteBySource(symbol, source, apiKey, fallbackOrder = ['eastmoney', 'sina', 'tencent', 'finnhubExtended', 'finnhub']) {
    if (source !== 'auto') {
        return fetchBySource(source, symbol, apiKey);
    }
    const order = fallbackOrder.filter((s) => ['eastmoney', 'sina', 'tencent', 'finnhubExtended', 'finnhub'].includes(s));
    const errors = [];
    for (const item of order) {
        try {
            if ((item === 'finnhub' || item === 'finnhubExtended') && !apiKey) {
                continue;
            }
            const quote = await fetchBySource(item, symbol, apiKey);
            quote.dataSource = `${quote.dataSource} (自动)`;
            return quote;
        }
        catch (error) {
            errors.push(`${getStockSourceLabel(item)}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(errors.join(' | ') || '所有数据源均失败');
}
function formatQuoteTooltip(quote) {
    const lines = [
        quote.name ? `${quote.name} (${quote.symbol})` : quote.symbol,
        `现价: ${(0, providers_1.formatPrice)(quote.price)}`,
        `涨跌: ${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`,
        `开盘: ${(0, providers_1.formatPrice)(quote.open)}`,
        `最高: ${(0, providers_1.formatPrice)(quote.high)}`,
        `最低: ${(0, providers_1.formatPrice)(quote.low)}`,
        `昨收: ${(0, providers_1.formatPrice)(quote.previousClose)}`,
    ];
    const intradayVolume = quote.volume && quote.volume > 0 ? quote.volume : undefined;
    const fallbackDailyVolume = quote.latestVolume && quote.latestVolume > 0 ? quote.latestVolume : undefined;
    const compareVolume = intradayVolume ?? fallbackDailyVolume;
    if (intradayVolume) {
        lines.push(`成交量: ${(0, providers_1.formatVolume)(intradayVolume)}`);
    }
    else if (fallbackDailyVolume) {
        lines.push(`昨成交量: ${(0, providers_1.formatVolume)(fallbackDailyVolume)}`);
    }
    if (quote.avgVolume5 && quote.avgVolume5 > 0) {
        const ratioText = compareVolume ? (0, volumeStats_1.formatVolumeRatio)(compareVolume, quote.avgVolume5) : undefined;
        const prefix = intradayVolume ? '今' : fallbackDailyVolume ? '昨' : undefined;
        lines.push(ratioText && prefix
            ? `5日均量: ${(0, providers_1.formatVolume)(quote.avgVolume5)} (${prefix}/5日 ${ratioText})`
            : `5日均量: ${(0, providers_1.formatVolume)(quote.avgVolume5)}`);
    }
    if (quote.avgVolume20 && quote.avgVolume20 > 0) {
        const ratioText = compareVolume ? (0, volumeStats_1.formatVolumeRatio)(compareVolume, quote.avgVolume20) : undefined;
        const prefix = intradayVolume ? '今' : fallbackDailyVolume ? '昨' : undefined;
        lines.push(ratioText && prefix
            ? `20日均量: ${(0, providers_1.formatVolume)(quote.avgVolume20)} (${prefix}/20日 ${ratioText})`
            : `20日均量: ${(0, providers_1.formatVolume)(quote.avgVolume20)}`);
    }
    if (quote.quoteVolume && quote.quoteVolume > 0) {
        lines.push(`成交额: ${(0, providers_1.formatVolume)(quote.quoteVolume)}`);
    }
    if (quote.session) {
        lines.push(`时段: ${(0, session_1.sessionLabel)(quote.session)}`);
    }
    if (quote.dataSource) {
        lines.push(`数据源: ${quote.dataSource}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=stockSources.js.map