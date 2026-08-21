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
exports.initBinancePairsCache = initBinancePairsCache;
exports.getCachedBinanceTradingPairs = getCachedBinanceTradingPairs;
exports.fetchBinanceTradingPairs = fetchBinanceTradingPairs;
exports.prefetchBinanceTradingPairs = prefetchBinanceTradingPairs;
exports.fetchCryptoQuote = fetchCryptoQuote;
exports.defaultSymbolLabel = defaultSymbolLabel;
exports.formatPrice = formatPrice;
exports.formatChangePercent = formatChangePercent;
exports.formatVolume = formatVolume;
exports.formatVolumeDetail = formatVolumeDetail;
exports.renderFormat = renderFormat;
const https = __importStar(require("https"));
function httpGet(url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
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
const CRYPTO_DISPLAY_NAMES = {
    BTCUSDT: 'Bitcoin',
    ETHUSDT: 'Ethereum',
    BNBUSDT: 'BNB',
    SOLUSDT: 'Solana',
    XRPUSDT: 'XRP',
    DOGEUSDT: 'Dogecoin',
};
function cryptoDisplayName(symbol) {
    const upper = symbol.toUpperCase();
    return CRYPTO_DISPLAY_NAMES[upper] ?? upper.replace(/USDT$|BUSD$|USD$/, '');
}
/** 交易对列表变化不频繁，本地缓存 24 小时 */
const BINANCE_PAIRS_TTL_MS = 24 * 60 * 60 * 1000;
let binancePairsCache;
let persistPairs;
let refreshInFlight;
/** 从 globalState 恢复缓存，并注册落盘回调（扩展启动时调用一次） */
function initBinancePairsCache(saved, onSave) {
    persistPairs = onSave;
    if (saved?.pairs?.length && typeof saved.fetchedAt === 'number') {
        binancePairsCache = saved;
    }
}
/** 同步读取本地缓存（有则立即可用，无需联网） */
function getCachedBinanceTradingPairs() {
    return binancePairsCache?.pairs?.length ? binancePairsCache.pairs : undefined;
}
function sortBinancePairs(pairs) {
    return [...pairs].sort((a, b) => {
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
/** 搜索列表只保留主流稳定币计价，减小体积、加快加载 */
function pairFromTickerSymbol(symbol, market) {
    if (symbol.endsWith('USDT')) {
        return {
            symbol,
            baseAsset: symbol.slice(0, -4),
            quoteAsset: 'USDT',
            market,
        };
    }
    if (symbol.endsWith('USDC')) {
        return {
            symbol,
            baseAsset: symbol.slice(0, -4),
            quoteAsset: 'USDC',
            market,
        };
    }
    return undefined;
}
async function fetchPairsFromTickerPrice(url, market) {
    // ticker/price 比 exchangeInfo 小很多，避免一直卡在「加载交易对」
    const body = await httpGet(url, 12000);
    const json = JSON.parse(body);
    if (!Array.isArray(json)) {
        return [];
    }
    const pairs = [];
    for (const item of json) {
        const pair = pairFromTickerSymbol(item.symbol, market);
        if (pair) {
            pairs.push(pair);
        }
    }
    return pairs;
}
async function fetchSpotTradingPairs() {
    return fetchPairsFromTickerPrice('https://api.binance.com/api/v3/ticker/price', 'spot');
}
async function fetchFuturesTradingPairs() {
    return fetchPairsFromTickerPrice('https://fapi.binance.com/fapi/v1/ticker/price', 'futures');
}
function savePairsCache(pairs) {
    const snapshot = { pairs, fetchedAt: Date.now() };
    binancePairsCache = snapshot;
    persistPairs?.(snapshot);
    return pairs;
}
function mergeSpotAndFutures(spot, futures) {
    const bySymbol = new Map();
    for (const pair of spot) {
        bySymbol.set(pair.symbol, pair);
    }
    for (const pair of futures) {
        if (!bySymbol.has(pair.symbol)) {
            bySymbol.set(pair.symbol, pair);
        }
    }
    return sortBinancePairs([...bySymbol.values()]);
}
async function refreshBinanceTradingPairs() {
    if (refreshInFlight) {
        return refreshInFlight;
    }
    refreshInFlight = (async () => {
        const results = await Promise.allSettled([fetchSpotTradingPairs(), fetchFuturesTradingPairs()]);
        const spot = results[0].status === 'fulfilled' ? results[0].value : [];
        const futures = results[1].status === 'fulfilled' ? results[1].value : [];
        const pairs = mergeSpotAndFutures(spot, futures);
        if (pairs.length === 0) {
            const errors = results
                .filter((r) => r.status === 'rejected')
                .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
            throw new Error(errors.join(' | ') || '无法加载 Binance 交易对');
        }
        return savePairsCache(pairs);
    })();
    try {
        return await refreshInFlight;
    }
    finally {
        refreshInFlight = undefined;
    }
}
function isPairsCacheFresh() {
    return !!binancePairsCache && Date.now() - binancePairsCache.fetchedAt < BINANCE_PAIRS_TTL_MS;
}
/**
 * 拉取 Binance 现货 + 合约 TRADING 交易对。
 * 有本地缓存时立即返回；过期则后台刷新，避免每次添加都卡在加载提示。
 */
async function fetchBinanceTradingPairs() {
    const cached = getCachedBinanceTradingPairs();
    if (cached) {
        if (!isPairsCacheFresh()) {
            void refreshBinanceTradingPairs().catch(() => undefined);
        }
        return cached;
    }
    return refreshBinanceTradingPairs();
}
/** 扩展启动时后台预热，打开添加面板时通常已就绪 */
function prefetchBinanceTradingPairs() {
    if (isPairsCacheFresh()) {
        return;
    }
    void refreshBinanceTradingPairs().catch(() => undefined);
}
function quoteFromTicker(upper, json, dataSource) {
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
async function fetchSpotCryptoQuote(upper) {
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(upper)}`;
    const body = await httpGet(url);
    return quoteFromTicker(upper, JSON.parse(body), 'Binance');
}
async function fetchFuturesCryptoQuote(upper) {
    const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(upper)}`;
    const body = await httpGet(url);
    return quoteFromTicker(upper, JSON.parse(body), 'Binance Futures');
}
/** Binance 24hr ticker：先现货，失败再试 U 本位合约（如 STRCUSDT） */
async function fetchCryptoQuote(symbol) {
    const upper = symbol.toUpperCase();
    try {
        return await fetchSpotCryptoQuote(upper);
    }
    catch (spotError) {
        try {
            return await fetchFuturesCryptoQuote(upper);
        }
        catch {
            throw spotError instanceof Error ? spotError : new Error(String(spotError));
        }
    }
}
function defaultSymbolLabel(symbol) {
    if (symbol.endsWith('USDT')) {
        return symbol.replace('USDT', '');
    }
    const lower = symbol.toLowerCase();
    if (/^(sh|sz|bj)\d{6}$/.test(lower)) {
        return lower.slice(2);
    }
    return symbol;
}
function formatPrice(price) {
    if (price >= 1000) {
        return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (price >= 1) {
        return price.toFixed(2);
    }
    return price.toFixed(4);
}
function formatChangePercent(changePercent) {
    const sign = changePercent >= 0 ? '+' : '';
    return `${sign}${changePercent.toFixed(2)}%`;
}
/** 格式化大数字成交量/成交额，如 1.23B、456.7M */
function formatVolume(value) {
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
function formatVolumeDetail(quote) {
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
function renderFormat(template, symbol, price, changePercent, showIcon, volumeText) {
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
//# sourceMappingURL=providers.js.map