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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const providers_1 = require("./providers");
function getConfig() {
    return vscode.workspace.getConfiguration('kanpan');
}
class KanpanTicker {
    constructor(context) {
        this.context = context;
        this.items = [];
        this.visible = true;
    }
    start() {
        this.disposeItems();
        this.rebuildItems();
        this.scheduleRefresh();
    }
    setVisible(visible) {
        this.visible = visible;
        for (const item of this.items) {
            item.statusBarItem.hide();
        }
        if (visible) {
            void this.refresh();
        }
    }
    async refresh() {
        if (!this.visible) {
            return;
        }
        const config = getConfig();
        if (!config.get('enabled', true)) {
            for (const item of this.items) {
                item.statusBarItem.hide();
            }
            return;
        }
        if (config.get('onlyRefreshWhenFocused', false) && !vscode.window.state.focused) {
            return;
        }
        this.rebuildItemsIfNeeded();
        await Promise.all(this.items.map(async (item) => {
            try {
                const quote = await this.fetchQuote(item);
                this.updateStatusBarItem(item, quote);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const label = this.getDisplayLabel(item.symbol);
                item.statusBarItem.text = `$(warning) ${label}`;
                item.statusBarItem.tooltip = `${item.symbol}: ${message}`;
                item.statusBarItem.color = undefined;
                item.statusBarItem.show();
            }
        }));
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
        const config = getConfig();
        const stocks = config.get('stocks', []);
        const upper = symbol.trim().toUpperCase();
        if (stocks.includes(upper)) {
            vscode.window.showInformationMessage(`${upper} 已在列表中`);
            return;
        }
        await config.update('stocks', [...stocks, upper], vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`已添加美股 ${upper}`);
        this.start();
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
        const config = getConfig();
        const symbols = config.get('cryptoSymbols', []);
        const upper = symbol.trim().toUpperCase();
        if (symbols.includes(upper)) {
            vscode.window.showInformationMessage(`${upper} 已在列表中`);
            return;
        }
        await config.update('cryptoSymbols', [...symbols, upper], vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`已添加 ${upper}`);
        this.start();
    }
    getDisplayLabel(symbol) {
        const aliases = getConfig().get('aliases', {});
        return aliases[symbol] ?? (0, providers_1.defaultSymbolLabel)(symbol);
    }
    rebuildItemsIfNeeded() {
        const config = getConfig();
        const stocks = config.get('stocks', ['AAPL', 'NVDA', 'TSLA']);
        const cryptoSymbols = config.get('cryptoSymbols', ['BTCUSDT']);
        const expectedKeys = [
            ...stocks.map((s) => `stock:${s.toUpperCase()}`),
            ...cryptoSymbols.map((s) => `crypto:${s.toUpperCase()}`),
        ];
        if (expectedKeys.join('|') !== this.items.map((i) => i.key).join('|')) {
            this.rebuildItems();
        }
    }
    rebuildItems() {
        this.disposeItems();
        const config = getConfig();
        const stocks = config.get('stocks', ['AAPL', 'NVDA', 'TSLA']);
        const cryptoSymbols = config.get('cryptoSymbols', ['BTCUSDT']);
        let priority = 100;
        for (const symbol of stocks) {
            this.items.push(this.createItem('stock', symbol.toUpperCase(), priority--));
        }
        for (const symbol of cryptoSymbols) {
            this.items.push(this.createItem('crypto', symbol.toUpperCase(), priority--));
        }
    }
    createItem(type, symbol, priority) {
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
        statusBarItem.command = 'kanpan.refresh';
        this.context.subscriptions.push(statusBarItem);
        return { key: `${type}:${symbol}`, type, symbol, statusBarItem };
    }
    async fetchQuote(item) {
        if (item.type === 'stock') {
            const apiKey = getConfig().get('finnhubApiKey', '');
            return (0, providers_1.fetchStockQuote)(item.symbol, apiKey);
        }
        return (0, providers_1.fetchCryptoQuote)(item.symbol);
    }
    updateStatusBarItem(item, quote) {
        const config = getConfig();
        const monochrome = config.get('monochrome', false);
        const showChangePercent = config.get('showChangePercent', true);
        const riseColor = config.get('riseColor', '#26a69a');
        const fallColor = config.get('fallColor', '#ef5350');
        const format = config.get('format', '{symbol} {price} {change} {icon}');
        const label = this.getDisplayLabel(quote.symbol);
        const priceText = (0, providers_1.formatPrice)(quote.price);
        const changeText = (0, providers_1.formatChangePercent)(quote.changePercent);
        if (showChangePercent) {
            item.statusBarItem.text = (0, providers_1.renderFormat)(format, label, quote.price, quote.changePercent, !monochrome);
        }
        else {
            item.statusBarItem.text = `${label} ${priceText}`;
        }
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
    scheduleRefresh() {
        if (this.timer) {
            clearInterval(this.timer);
        }
        const interval = Math.max(getConfig().get('refreshInterval', 10000), 5000);
        void this.refresh();
        this.timer = setInterval(() => void this.refresh(), interval);
    }
    disposeItems() {
        for (const item of this.items) {
            item.statusBarItem.dispose();
        }
        this.items = [];
    }
}
function activate(context) {
    const ticker = new KanpanTicker(context);
    context.subscriptions.push(vscode.commands.registerCommand('kanpan.refresh', () => ticker.refresh()), vscode.commands.registerCommand('kanpan.show', () => ticker.setVisible(true)), vscode.commands.registerCommand('kanpan.hide', () => ticker.setVisible(false)), vscode.commands.registerCommand('kanpan.addStock', () => ticker.addStock()), vscode.commands.registerCommand('kanpan.addCrypto', () => ticker.addCrypto()), vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('kanpan')) {
            ticker.start();
        }
    }), vscode.window.onDidChangeWindowState(() => {
        void ticker.refresh();
    }));
    ticker.start();
}
function deactivate() { }
//# sourceMappingURL=extension.js.map