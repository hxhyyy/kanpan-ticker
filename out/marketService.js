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
exports.MarketService = exports.MarketStore = void 0;
exports.marketKeyOf = marketKeyOf;
exports.parseMarketKey = parseMarketKey;
exports.getConfig = getConfig;
exports.getDisplayLabel = getDisplayLabel;
const vscode = __importStar(require("vscode"));
const providers_1 = require("./providers");
function marketKeyOf(type, symbol) {
    return `${type}:${symbol.toUpperCase()}`;
}
function parseMarketKey(key) {
    const [type, symbol] = key.split(':');
    return { type: type, symbol };
}
function getConfig() {
    return vscode.workspace.getConfiguration('kanpan');
}
function getDisplayLabel(symbol) {
    const aliases = getConfig().get('aliases', {});
    return aliases[symbol] ?? (0, providers_1.defaultSymbolLabel)(symbol);
}
class MarketStore {
    constructor() {
        this.cache = new Map();
        this.listeners = new Set();
    }
    onUpdate(listener) {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }
    get(key) {
        return this.cache.get(key);
    }
    setQuote(key, quote) {
        this.cache.set(key, { quote });
    }
    setError(key, error) {
        this.cache.set(key, { error });
    }
    notify() {
        for (const listener of this.listeners) {
            listener();
        }
    }
}
exports.MarketStore = MarketStore;
class MarketService {
    constructor(context, store) {
        this.context = context;
        this.store = store;
        this.statusVisible = true;
        this.statusItems = [];
    }
    start() {
        this.rebuildStatusItems();
        this.scheduleRefresh();
    }
    setStatusVisible(visible) {
        this.statusVisible = visible;
        for (const item of this.statusItems) {
            item.statusBarItem.hide();
        }
        if (visible) {
            void this.refresh();
        }
    }
    async refresh() {
        const config = getConfig();
        const stocks = config.get('stocks', ['AAPL', 'NVDA', 'TSLA']).map((s) => s.toUpperCase());
        const cryptoSymbols = config
            .get('cryptoSymbols', ['BTCUSDT'])
            .map((s) => s.toUpperCase());
        if (config.get('onlyRefreshWhenFocused', false) && !vscode.window.state.focused) {
            return;
        }
        this.rebuildStatusItemsIfNeeded(stocks, cryptoSymbols);
        const tasks = [];
        for (const symbol of stocks) {
            tasks.push(this.fetchAndCache('stock', symbol));
        }
        for (const symbol of cryptoSymbols) {
            tasks.push(this.fetchAndCache('crypto', symbol));
        }
        await Promise.all(tasks);
        this.store.notify();
        this.updateStatusBar(config);
    }
    async addStock() {
        const symbol = await vscode.window.showInputBox({
            prompt: '输入美股代码，如 AAPL、NVDA',
            placeHolder: 'AAPL',
            validateInput: (value) => {
                if (!value.trim()) {
                    return '代码不能为空';
                }
                if (!/^[A-Za-z.\-]+$/.test(value.trim())) {
                    return '请输入有效的美股代码';
                }
                return undefined;
            },
        });
        if (!symbol) {
            return;
        }
        const stocks = getConfig().get('stocks', []);
        const upper = symbol.trim().toUpperCase();
        if (stocks.includes(upper)) {
            vscode.window.showInformationMessage(`${upper} 已在列表中`);
            return;
        }
        await getConfig().update('stocks', [...stocks, upper], vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`已添加美股 ${upper}`);
        this.start();
        void this.refresh();
    }
    async addCrypto() {
        const symbol = await vscode.window.showInputBox({
            prompt: '输入 Binance 交易对，如 BTCUSDT、ETHUSDT',
            placeHolder: 'BTCUSDT',
            validateInput: (value) => {
                if (!value.trim()) {
                    return '交易对不能为空';
                }
                if (!/^[A-Za-z0-9]+$/.test(value.trim())) {
                    return '请输入有效的交易对';
                }
                return undefined;
            },
        });
        if (!symbol) {
            return;
        }
        const symbols = getConfig().get('cryptoSymbols', []);
        const upper = symbol.trim().toUpperCase();
        if (symbols.includes(upper)) {
            vscode.window.showInformationMessage(`${upper} 已在列表中`);
            return;
        }
        await getConfig().update('cryptoSymbols', [...symbols, upper], vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`已添加 ${upper}`);
        this.start();
        void this.refresh();
    }
    async removeStock(symbol) {
        const stocks = getConfig().get('stocks', []);
        await getConfig().update('stocks', stocks.filter((s) => s.toUpperCase() !== symbol.toUpperCase()), vscode.ConfigurationTarget.Global);
        this.start();
        void this.refresh();
    }
    async removeCrypto(symbol) {
        const symbols = getConfig().get('cryptoSymbols', []);
        await getConfig().update('cryptoSymbols', symbols.filter((s) => s.toUpperCase() !== symbol.toUpperCase()), vscode.ConfigurationTarget.Global);
        this.start();
        void this.refresh();
    }
    async fetchAndCache(type, symbol) {
        const key = marketKeyOf(type, symbol);
        try {
            const quote = type === 'stock'
                ? await (0, providers_1.fetchStockQuote)(symbol, getConfig().get('finnhubApiKey', ''))
                : await (0, providers_1.fetchCryptoQuote)(symbol);
            this.store.setQuote(key, quote);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.store.setError(key, message);
        }
    }
    updateStatusBar(config) {
        if (!this.statusVisible || !config.get('enabled', true)) {
            for (const item of this.statusItems) {
                item.statusBarItem.hide();
            }
            return;
        }
        const monochrome = config.get('monochrome', false);
        const showChangePercent = config.get('showChangePercent', true);
        const riseColor = config.get('riseColor', '#26a69a');
        const fallColor = config.get('fallColor', '#ef5350');
        const format = config.get('format', '{symbol} {price} {change} {icon}');
        for (const item of this.statusItems) {
            const cached = this.store.get(item.key);
            const label = getDisplayLabel(item.symbol);
            if (cached?.error) {
                item.statusBarItem.text = `$(warning) ${label}`;
                item.statusBarItem.tooltip = `${item.symbol}: ${cached.error}`;
                item.statusBarItem.color = undefined;
                item.statusBarItem.show();
                continue;
            }
            if (!cached?.quote) {
                item.statusBarItem.text = `$(sync~spin) ${label}`;
                item.statusBarItem.tooltip = `${item.symbol}: 加载中...`;
                item.statusBarItem.color = undefined;
                item.statusBarItem.show();
                continue;
            }
            const quote = cached.quote;
            const priceText = (0, providers_1.formatPrice)(quote.price);
            const changeText = (0, providers_1.formatChangePercent)(quote.changePercent);
            item.statusBarItem.text = showChangePercent
                ? (0, providers_1.renderFormat)(format, label, quote.price, quote.changePercent, !monochrome)
                : `${label} ${priceText}`;
            item.statusBarItem.color = monochrome
                ? undefined
                : quote.changePercent >= 0
                    ? riseColor
                    : fallColor;
            item.statusBarItem.tooltip = [
                quote.symbol,
                `现价: ${priceText}`,
                `涨跌: ${changeText}`,
                `开盘: ${(0, providers_1.formatPrice)(quote.open)}`,
                `最高: ${(0, providers_1.formatPrice)(quote.high)}`,
                `最低: ${(0, providers_1.formatPrice)(quote.low)}`,
                `昨收: ${(0, providers_1.formatPrice)(quote.previousClose)}`,
                '',
                '点击刷新',
            ].join('\n');
            item.statusBarItem.show();
        }
    }
    rebuildStatusItemsIfNeeded(stocks, cryptoSymbols) {
        const expectedKeys = [
            ...stocks.map((s) => marketKeyOf('stock', s)),
            ...cryptoSymbols.map((s) => marketKeyOf('crypto', s)),
        ];
        if (expectedKeys.join('|') !== this.statusItems.map((i) => i.key).join('|')) {
            this.rebuildStatusItems();
        }
    }
    rebuildStatusItems() {
        for (const item of this.statusItems) {
            item.statusBarItem.dispose();
        }
        this.statusItems = [];
        const stocks = getConfig().get('stocks', ['AAPL', 'NVDA', 'TSLA']);
        const cryptoSymbols = getConfig().get('cryptoSymbols', ['BTCUSDT']);
        let priority = 100;
        for (const symbol of stocks) {
            this.statusItems.push(this.createStatusItem('stock', symbol.toUpperCase(), priority--));
        }
        for (const symbol of cryptoSymbols) {
            this.statusItems.push(this.createStatusItem('crypto', symbol.toUpperCase(), priority--));
        }
    }
    createStatusItem(type, symbol, priority) {
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
        statusBarItem.command = 'kanpan.refresh';
        this.context.subscriptions.push(statusBarItem);
        return { key: marketKeyOf(type, symbol), type, symbol, statusBarItem };
    }
    scheduleRefresh() {
        if (this.timer) {
            clearInterval(this.timer);
        }
        const interval = Math.max(getConfig().get('refreshInterval', 10000), 5000);
        void this.refresh();
        this.timer = setInterval(() => void this.refresh(), interval);
    }
}
exports.MarketService = MarketService;
//# sourceMappingURL=marketService.js.map