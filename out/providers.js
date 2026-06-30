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
exports.fetchCryptoQuote = fetchCryptoQuote;
exports.defaultSymbolLabel = defaultSymbolLabel;
exports.formatPrice = formatPrice;
exports.formatChangePercent = formatChangePercent;
exports.formatVolume = formatVolume;
exports.formatVolumeDetail = formatVolumeDetail;
exports.renderFormat = renderFormat;
const https = __importStar(require("https"));
function httpGet(url) {
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
/** Binance 24hr ticker - same approach as CryptoTickerPlus */
async function fetchCryptoQuote(symbol) {
    const upper = symbol.toUpperCase();
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(upper)}`;
    const body = await httpGet(url);
    const json = JSON.parse(body);
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
        dataSource: 'Binance',
    };
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