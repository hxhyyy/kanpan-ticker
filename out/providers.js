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
/** Binance 24hr ticker - same approach as CryptoTickerPlus */
async function fetchCryptoQuote(symbol) {
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
    const body = await httpGet(url);
    const json = JSON.parse(body);
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
function defaultSymbolLabel(symbol) {
    if (symbol.endsWith('USDT')) {
        return symbol.replace('USDT', '');
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
function renderFormat(template, symbol, price, changePercent, showIcon) {
    const icon = showIcon ? (changePercent >= 0 ? '$(arrow-up)' : '$(arrow-down)') : '';
    return template
        .replace(/\{symbol\}/g, symbol)
        .replace(/\{price\}/g, formatPrice(price))
        .replace(/\{change\}/g, formatChangePercent(changePercent))
        .replace(/\{icon\}/g, icon)
        .replace(/\s+/g, ' ')
        .trim();
}
//# sourceMappingURL=providers.js.map