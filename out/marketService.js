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
exports.getStatusBarItems = getStatusBarItems;
exports.setStatusBarItems = setStatusBarItems;
exports.isInStatusBar = isInStatusBar;
exports.getStockDataSource = getStockDataSource;
exports.setStockDataSource = setStockDataSource;
exports.getDisplayLabel = getDisplayLabel;
const vscode = __importStar(require("vscode"));
const providers_1 = require("./providers");
const stockSources_1 = require("./stockSources");
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
const STOCK_SOURCE_STATE_KEY = 'stockDataSource';
const STATUS_BAR_ITEMS_STATE_KEY = 'statusBarItems';
function getStatusBarItems(context) {
    const fromState = context.globalState.get(STATUS_BAR_ITEMS_STATE_KEY);
    const items = fromState && fromState.length > 0 ? fromState : getConfig().get('statusBarItems', []);
    return items.map((k) => {
        const colon = k.indexOf(':');
        if (colon < 0) {
            return k;
        }
        return `${k.slice(0, colon)}:${k.slice(colon + 1).toUpperCase()}`;
    });
}
async function setStatusBarItems(context, items) {
    const normalized = items.map((k) => {
        const [type, symbol] = k.split(':');
        return `${type}:${symbol.toUpperCase()}`;
    });
    await context.globalState.update(STATUS_BAR_ITEMS_STATE_KEY, normalized);
    try {
        await getConfig().update('statusBarItems', normalized, vscode.ConfigurationTarget.Global);
    }
    catch {
        // ignore
    }
}
function isInStatusBar(context, key) {
    return getStatusBarItems(context).includes(key);
}
function getStockDataSource(context) {
    const fromState = context.globalState.get(STOCK_SOURCE_STATE_KEY);
    if (fromState) {
        return fromState;
    }
    return getConfig().get('stockDataSource', 'auto');
}
async function setStockDataSource(context, source) {
    await context.globalState.update(STOCK_SOURCE_STATE_KEY, source);
    try {
        await getConfig().update('stockDataSource', source, vscode.ConfigurationTarget.Global);
    }
    catch {
        // 旧版 manifest 未注册该配置时，globalState 仍可保存选择
    }
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
        void this.ensureStatusBarDefaults().then(() => {
            this.rebuildStatusItems();
            this.scheduleRefresh();
        });
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
        this.rebuildStatusItemsIfNeeded();
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
        const key = marketKeyOf('stock', symbol);
        const stocks = getConfig().get('stocks', []);
        await getConfig().update('stocks', stocks.filter((s) => s.toUpperCase() !== symbol.toUpperCase()), vscode.ConfigurationTarget.Global);
        await setStatusBarItems(this.context, getStatusBarItems(this.context).filter((item) => item !== key));
        this.start();
        void this.refresh();
    }
    async removeCrypto(symbol) {
        const key = marketKeyOf('crypto', symbol);
        const symbols = getConfig().get('cryptoSymbols', []);
        await getConfig().update('cryptoSymbols', symbols.filter((s) => s.toUpperCase() !== symbol.toUpperCase()), vscode.ConfigurationTarget.Global);
        await setStatusBarItems(this.context, getStatusBarItems(this.context).filter((item) => item !== key));
        this.start();
        void this.refresh();
    }
    async selectStockSource() {
        const current = getStockDataSource(this.context);
        const picked = await vscode.window.showQuickPick(stockSources_1.STOCK_SOURCE_OPTIONS.map((option) => ({
            label: option.id === current ? `$(check) ${option.label}` : option.label,
            description: option.description,
            detail: option.needsApiKey ? '需要 Finnhub API Key' : '无需 API Key',
            id: option.id,
        })), {
            placeHolder: '选择美股数据源',
            title: '看盘插件 - 美股数据源',
        });
        if (!picked) {
            return;
        }
        await setStockDataSource(this.context, picked.id);
        vscode.window.showInformationMessage(`美股数据源已切换为：${(0, stockSources_1.getStockSourceLabel)(picked.id)}`);
        void this.refresh();
    }
    getCurrentStockSourceLabel() {
        return (0, stockSources_1.getStockSourceLabel)(getStockDataSource(this.context));
    }
    async addToStatusBar(key) {
        const normalized = key.includes(':') ? key : '';
        if (!normalized || (!normalized.startsWith('stock:') && !normalized.startsWith('crypto:'))) {
            return;
        }
        const items = getStatusBarItems(this.context);
        if (items.includes(normalized)) {
            vscode.window.showInformationMessage(`${getDisplayLabel(normalized.split(':')[1])} 已在状态栏中`);
            return;
        }
        await setStatusBarItems(this.context, [...items, normalized]);
        const label = getDisplayLabel(normalized.split(':')[1]);
        vscode.window.showInformationMessage(`已添加 ${label} 到状态栏`);
        this.rebuildStatusItems();
        void this.refresh();
    }
    async removeFromStatusBar(key) {
        const items = getStatusBarItems(this.context);
        if (!items.includes(key)) {
            return;
        }
        await setStatusBarItems(this.context, items.filter((item) => item !== key));
        const label = getDisplayLabel(key.split(':')[1]);
        vscode.window.showInformationMessage(`已从状态栏移除 ${label}`);
        this.rebuildStatusItems();
        void this.refresh();
    }
    async ensureStatusBarDefaults() {
        const items = getStatusBarItems(this.context);
        if (items.length > 0) {
            return;
        }
        const config = getConfig();
        const defaults = [
            ...config.get('stocks', ['AAPL', 'NVDA', 'TSLA']).map((s) => marketKeyOf('stock', s)),
            ...config.get('cryptoSymbols', ['BTCUSDT']).map((s) => marketKeyOf('crypto', s)),
        ];
        if (defaults.length > 0) {
            await setStatusBarItems(this.context, defaults);
        }
    }
    async fetchAndCache(type, symbol) {
        const key = marketKeyOf(type, symbol);
        try {
            const quote = type === 'stock'
                ? await (0, stockSources_1.fetchStockQuoteBySource)(symbol, getStockDataSource(this.context), getConfig().get('finnhubApiKey', ''), getConfig().get('autoFallbackOrder', [
                    'eastmoney',
                    'sina',
                    'tencent',
                    'finnhubExtended',
                    'finnhub',
                ]))
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
        const showVolume = config.get('showVolume', true);
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
                ? (0, providers_1.renderFormat)(format, label, quote.price, quote.changePercent, !monochrome, showVolume ? (0, providers_1.formatVolumeDetail)(quote) : undefined)
                : `${label} ${priceText}`;
            item.statusBarItem.color = monochrome
                ? undefined
                : quote.changePercent >= 0
                    ? riseColor
                    : fallColor;
            item.statusBarItem.tooltip = [
                (0, stockSources_1.formatQuoteTooltip)(quote),
                '',
                '点击刷新',
            ].join('\n');
            item.statusBarItem.show();
        }
    }
    rebuildStatusItemsIfNeeded() {
        const statusKeys = getStatusBarItems(this.context);
        const position = getConfig().get('statusBarPosition', 'left');
        const keysMatch = statusKeys.join('|') === this.statusItems.map((i) => i.key).join('|');
        if (!keysMatch || this.lastStatusBarPosition !== position) {
            this.lastStatusBarPosition = position;
            this.rebuildStatusItems();
        }
    }
    rebuildStatusItems() {
        for (const item of this.statusItems) {
            item.statusBarItem.dispose();
        }
        this.statusItems = [];
        const statusKeys = getStatusBarItems(this.context);
        let priority = 100;
        for (const key of statusKeys) {
            const parsed = parseMarketKey(key);
            this.statusItems.push(this.createStatusItem(parsed.type, parsed.symbol, priority--));
        }
    }
    getStatusBarAlignment() {
        const position = getConfig().get('statusBarPosition', 'left');
        return position === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
    }
    createStatusItem(type, symbol, priority) {
        const statusBarItem = vscode.window.createStatusBarItem(this.getStatusBarAlignment(), priority);
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