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
const aShareSources_1 = require("./aShareSources");
const colorSettings_1 = require("./colorSettings");
const reorder_1 = require("./sidebar/reorder");
function marketKeyOf(type, symbol) {
    if (type === 'ashare') {
        return `${type}:${(0, aShareSources_1.normalizeAShareCode)(symbol)}`;
    }
    return `${type}:${symbol.toUpperCase()}`;
}
function parseMarketKey(key) {
    const colon = key.indexOf(':');
    const type = key.slice(0, colon);
    const symbol = key.slice(colon + 1);
    return {
        type,
        symbol: type === 'ashare' ? symbol.toLowerCase() : symbol.toUpperCase(),
    };
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
        const type = k.slice(0, colon);
        const symbol = k.slice(colon + 1);
        if (type === 'ashare') {
            return `${type}:${symbol.toLowerCase()}`;
        }
        return `${type}:${symbol.toUpperCase()}`;
    });
}
async function setStatusBarItems(context, items) {
    const normalized = items.map((k) => {
        const colon = k.indexOf(':');
        if (colon < 0) {
            return k;
        }
        const type = k.slice(0, colon);
        const symbol = k.slice(colon + 1);
        if (type === 'ashare') {
            return `${type}:${(0, aShareSources_1.normalizeAShareCode)(symbol)}`;
        }
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
function getDisplayLabel(symbol, name) {
    if (name) {
        return name;
    }
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
        await Promise.all([this.refreshStocks(), this.refreshCrypto()]);
    }
    async refreshStocks() {
        const config = getConfig();
        if (config.get('onlyRefreshWhenFocused', false) && !vscode.window.state.focused) {
            return;
        }
        this.rebuildStatusItemsIfNeeded();
        const stocks = config.get('stocks', ['AAPL', 'NVDA', 'TSLA']).map((s) => s.toUpperCase());
        const aShares = config.get('aShares', ['sh600519', 'sz300750']).map((s) => (0, aShareSources_1.normalizeAShareCode)(s));
        await Promise.all([
            ...stocks.map((symbol) => this.fetchAndCache('stock', symbol)),
            ...aShares.map((symbol) => this.fetchAndCache('ashare', symbol)),
        ]);
        this.store.notify();
        this.updateStatusBar(config);
    }
    async refreshCrypto() {
        const config = getConfig();
        if (config.get('onlyRefreshWhenFocused', false) && !vscode.window.state.focused) {
            return;
        }
        this.rebuildStatusItemsIfNeeded();
        const cryptoSymbols = config
            .get('cryptoSymbols', ['BTCUSDT'])
            .map((s) => s.toUpperCase());
        await Promise.all(cryptoSymbols.map((symbol) => this.fetchAndCache('crypto', symbol)));
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
    async addAShare() {
        const input = await vscode.window.showInputBox({
            prompt: '输入 A 股代码或中文名称，如 600519、贵州茅台、茅台',
            placeHolder: '600519 或 贵州茅台',
            validateInput: (value) => (value.trim() ? undefined : '不能为空'),
        });
        if (!input) {
            return;
        }
        const trimmed = input.trim();
        let code;
        let displayName;
        if ((0, aShareSources_1.isAShareCodeInput)(trimmed)) {
            if ((0, aShareSources_1.isAmbiguousBareCode)(trimmed)) {
                const bare = trimmed.padStart(6, '0');
                const options = aShareSources_1.AMBIGUOUS_BARE_CODES[bare] ?? [];
                const picked = await vscode.window.showQuickPick(options.map((item) => ({
                    label: item.name,
                    description: item.code,
                    code: item.code,
                })), { placeHolder: `「${bare}」对应多个标的，请选择` });
                if (!picked) {
                    return;
                }
                code = picked.code;
                displayName = picked.label;
            }
            else {
                try {
                    code = (0, aShareSources_1.normalizeAShareCode)(trimmed);
                }
                catch (error) {
                    vscode.window.showErrorMessage(error instanceof Error ? error.message : '无效的 A 股代码');
                    return;
                }
            }
        }
        else {
            const results = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在搜索「${trimmed}」...`,
            }, () => (0, aShareSources_1.searchAShare)(trimmed));
            if (results.length === 0) {
                vscode.window.showWarningMessage(`未找到与「${trimmed}」匹配的 A 股`);
                return;
            }
            if (results.length === 1) {
                code = results[0].code;
                displayName = results[0].name;
            }
            else {
                const picked = await vscode.window.showQuickPick(results.map((item) => ({
                    label: item.name,
                    description: [item.code.slice(2), item.typeName].filter(Boolean).join(' · '),
                    detail: item.code,
                    code: item.code,
                })), {
                    placeHolder: `选择「${trimmed}」的匹配结果`,
                    matchOnDescription: true,
                    matchOnDetail: true,
                });
                if (!picked) {
                    return;
                }
                code = picked.code;
                displayName = picked.label;
            }
        }
        const aShares = getConfig().get('aShares', []);
        if (aShares.map((s) => (0, aShareSources_1.normalizeAShareCode)(s)).includes(code)) {
            vscode.window.showInformationMessage(`${displayName ?? code} 已在列表中`);
            return;
        }
        await getConfig().update('aShares', [...aShares, code], vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`已添加 A 股 ${displayName ?? code}`);
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
    async removeAShare(symbol) {
        const code = (0, aShareSources_1.normalizeAShareCode)(symbol);
        const key = marketKeyOf('ashare', code);
        const aShares = getConfig().get('aShares', []);
        await getConfig().update('aShares', aShares.filter((s) => (0, aShareSources_1.normalizeAShareCode)(s) !== code), vscode.ConfigurationTarget.Global);
        await setStatusBarItems(this.context, getStatusBarItems(this.context).filter((item) => item !== key));
        this.start();
        void this.refresh();
    }
    async reorderWatchItem(sourceNodeId, targetNodeId) {
        const source = parseMarketKey(sourceNodeId);
        const target = parseMarketKey(targetNodeId);
        if (source.type !== target.type) {
            return false;
        }
        const list = (0, reorder_1.readWatchList)(source.type);
        const fromIndex = (0, reorder_1.indexInWatchList)(source.type, source.symbol, list);
        const toIndex = (0, reorder_1.indexInWatchList)(target.type, target.symbol, list);
        const next = (0, reorder_1.reorderList)(list, fromIndex, toIndex);
        if (!next) {
            return false;
        }
        await (0, reorder_1.writeWatchList)(source.type, next);
        this.start();
        void this.refresh();
        return true;
    }
    async moveWatchItem(nodeId, direction) {
        const parsed = parseMarketKey(nodeId);
        const list = (0, reorder_1.readWatchList)(parsed.type);
        const index = (0, reorder_1.indexInWatchList)(parsed.type, parsed.symbol, list);
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        const next = (0, reorder_1.reorderList)(list, index, targetIndex);
        if (!next) {
            return false;
        }
        await (0, reorder_1.writeWatchList)(parsed.type, next);
        this.start();
        void this.refresh();
        return true;
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
        const colon = key.indexOf(':');
        if (colon < 0) {
            return;
        }
        const type = key.slice(0, colon);
        if (type !== 'stock' && type !== 'crypto' && type !== 'ashare') {
            return;
        }
        const normalized = marketKeyOf(type, key.slice(colon + 1));
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
            ...config.get('aShares', ['sh600519', 'sz300750']).map((s) => marketKeyOf('ashare', s)),
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
                : type === 'ashare'
                    ? await (0, aShareSources_1.fetchAShareQuote)(symbol)
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
        const monochrome = (0, colorSettings_1.shouldUseNeutralColors)(config);
        const showChangePercent = config.get('showChangePercent', true);
        const { rise: riseColor, fall: fallColor } = (0, colorSettings_1.getRiseFallColors)(config);
        const format = config.get('format', '{symbol} {price} {change} {icon}');
        const showVolume = config.get('showVolume', true);
        for (const item of this.statusItems) {
            const cached = this.store.get(item.key);
            const label = getDisplayLabel(item.symbol, cached?.quote?.name);
            if (cached?.error) {
                item.statusBarItem.text = `$(warning) ${label}`;
                item.statusBarItem.tooltip = `${item.symbol}: ${cached.error}`;
                (0, colorSettings_1.clearStatusBarItemColors)(item.statusBarItem);
                item.statusBarItem.show();
                continue;
            }
            if (!cached?.quote) {
                item.statusBarItem.text = `$(sync~spin) ${label}`;
                item.statusBarItem.tooltip = `${item.symbol}: 加载中...`;
                (0, colorSettings_1.clearStatusBarItemColors)(item.statusBarItem);
                item.statusBarItem.show();
                continue;
            }
            const quote = cached.quote;
            const priceText = (0, providers_1.formatPrice)(quote.price);
            const changeText = (0, providers_1.formatChangePercent)(quote.changePercent);
            item.statusBarItem.text = showChangePercent
                ? (0, providers_1.renderFormat)(format, label, quote.price, quote.changePercent, !monochrome, showVolume && item.type === 'crypto' ? (0, providers_1.formatVolumeDetail)(quote) : undefined)
                : `${label} ${priceText}`;
            (0, colorSettings_1.applyStatusBarItemColors)(item.statusBarItem, quote.changePercent, monochrome, riseColor, fallColor);
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
        if (this.stockTimer) {
            clearInterval(this.stockTimer);
        }
        if (this.cryptoTimer) {
            clearInterval(this.cryptoTimer);
        }
        const stockInterval = Math.max(getConfig().get('stockRefreshInterval', 2000), 1000);
        const cryptoInterval = Math.max(getConfig().get('cryptoRefreshInterval', 1000), 1000);
        void this.refreshStocks();
        void this.refreshCrypto();
        this.stockTimer = setInterval(() => void this.refreshStocks(), stockInterval);
        this.cryptoTimer = setInterval(() => void this.refreshCrypto(), cryptoInterval);
    }
}
exports.MarketService = MarketService;
//# sourceMappingURL=marketService.js.map