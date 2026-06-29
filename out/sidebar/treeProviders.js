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
exports.SettingsTreeProvider = exports.CryptoTreeProvider = exports.StockTreeProvider = exports.KanpanTreeItem = void 0;
exports.bindExtensionContext = bindExtensionContext;
const vscode = __importStar(require("vscode"));
const providers_1 = require("../providers");
const marketService_1 = require("../marketService");
const session_1 = require("../session");
const stockSources_1 = require("../stockSources");
let extensionContext;
function bindExtensionContext(context) {
    extensionContext = context;
}
function currentStockSourceLabel() {
    if (!extensionContext) {
        return (0, stockSources_1.getStockSourceLabel)('auto');
    }
    return (0, stockSources_1.getStockSourceLabel)((0, marketService_1.getStockDataSource)(extensionContext));
}
class KanpanTreeItem extends vscode.TreeItem {
    constructor(nodeId, label, collapsibleState, options) {
        super(label, collapsibleState);
        this.nodeId = nodeId;
        if (options?.description) {
            this.description = options.description;
        }
        if (options?.tooltip) {
            this.tooltip = options.tooltip;
        }
        if (options?.iconId) {
            this.iconPath = new vscode.ThemeIcon(options.iconId);
        }
        if (options?.contextValue) {
            this.contextValue = options.contextValue;
        }
        if (options?.command) {
            this.command = options.command;
        }
    }
}
exports.KanpanTreeItem = KanpanTreeItem;
function buildQuoteTreeItem(type, symbol, store) {
    const key = (0, marketService_1.marketKeyOf)(type, symbol);
    const cached = store.get(key);
    const displayName = (0, marketService_1.getDisplayLabel)(symbol);
    if (cached?.error) {
        return new KanpanTreeItem(key, `[${displayName}]`, vscode.TreeItemCollapsibleState.None, {
            description: '加载失败',
            tooltip: `${symbol}\n${cached.error}`,
            iconId: 'warning',
            contextValue: type === 'stock' ? 'usStock' : 'crypto',
        });
    }
    if (!cached?.quote) {
        return new KanpanTreeItem(key, `[${displayName}]`, vscode.TreeItemCollapsibleState.None, {
            description: '加载中...',
            tooltip: symbol,
            iconId: 'sync~spin',
            contextValue: type === 'stock' ? 'usStock' : 'crypto',
        });
    }
    const quote = cached.quote;
    const changeText = (0, providers_1.formatChangePercent)(quote.changePercent);
    const priceText = (0, providers_1.formatPrice)(quote.price);
    const iconId = quote.changePercent >= 0 ? 'arrow-up' : 'arrow-down';
    const sessionText = quote.session ? (0, session_1.sessionLabel)(quote.session) : '';
    return new KanpanTreeItem(key, `[${displayName}]`, vscode.TreeItemCollapsibleState.None, {
        description: sessionText ? `${changeText}  ${priceText}  ${sessionText}` : `${changeText}  ${priceText}`,
        tooltip: (0, stockSources_1.formatQuoteTooltip)(quote),
        iconId,
        contextValue: type === 'stock' ? 'usStock' : 'crypto',
    });
}
class StockTreeProvider {
    constructor(store) {
        this.store = store;
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
        store.onUpdate(() => this.refresh());
    }
    refresh() {
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        const config = (0, marketService_1.getConfig)();
        const stocks = config.get('stocks', ['AAPL', 'NVDA', 'TSLA']).map((s) => s.toUpperCase());
        const source = currentStockSourceLabel();
        if (!element) {
            const count = stocks.length;
            return [
                new KanpanTreeItem('us-group', `US Stock(${count})`, stocks.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None, {
                    contextValue: 'stockGroup',
                    iconId: 'graph',
                    description: source,
                    tooltip: `当前数据源: ${source}\n在 Settings 中可切换数据源`,
                }),
            ];
        }
        if (element.nodeId === 'us-group') {
            if (stocks.length === 0) {
                return [
                    new KanpanTreeItem('empty-stock', '暂无美股，点击 + 添加', vscode.TreeItemCollapsibleState.None, {
                        iconId: 'info',
                    }),
                ];
            }
            return stocks.map((symbol) => buildQuoteTreeItem('stock', symbol, this.store));
        }
        return [];
    }
}
exports.StockTreeProvider = StockTreeProvider;
class CryptoTreeProvider {
    constructor(store) {
        this.store = store;
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
        store.onUpdate(() => this.refresh());
    }
    refresh() {
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        const config = vscode.workspace.getConfiguration('kanpan');
        const symbols = config.get('cryptoSymbols', ['BTCUSDT']).map((s) => s.toUpperCase());
        if (!element) {
            const count = symbols.length;
            return [
                new KanpanTreeItem('crypto-group', `Crypto(${count})`, symbols.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None, { contextValue: 'cryptoGroup', iconId: 'symbol-bitcoin', description: 'Binance' }),
            ];
        }
        if (element.nodeId === 'crypto-group') {
            if (symbols.length === 0) {
                return [
                    new KanpanTreeItem('empty-crypto', '暂无加密货币，点击 + 添加', vscode.TreeItemCollapsibleState.None, {
                        iconId: 'info',
                    }),
                ];
            }
            return symbols.map((symbol) => buildQuoteTreeItem('crypto', symbol, this.store));
        }
        return [];
    }
}
exports.CryptoTreeProvider = CryptoTreeProvider;
class SettingsTreeProvider {
    constructor() {
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    }
    refresh() {
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        const source = currentStockSourceLabel();
        return [
            new KanpanTreeItem('settings-source', '切换美股数据源', vscode.TreeItemCollapsibleState.None, {
                iconId: 'server-environment',
                description: source,
                tooltip: `当前: ${source}\n点击选择 Finnhub / 东财 / 新浪 / 腾讯 / 自动`,
                command: { command: 'kanpan.selectStockSource', title: '切换数据源' },
            }),
            new KanpanTreeItem('settings-refresh', '刷新行情', vscode.TreeItemCollapsibleState.None, {
                iconId: 'refresh',
                command: { command: 'kanpan.refresh', title: '刷新' },
            }),
            new KanpanTreeItem('settings-add-stock', '添加美股', vscode.TreeItemCollapsibleState.None, {
                iconId: 'add',
                command: { command: 'kanpan.addStock', title: '添加美股' },
            }),
            new KanpanTreeItem('settings-add-crypto', '添加加密货币', vscode.TreeItemCollapsibleState.None, {
                iconId: 'add',
                command: { command: 'kanpan.addCrypto', title: '添加加密货币' },
            }),
            new KanpanTreeItem('settings-open', '打开设置', vscode.TreeItemCollapsibleState.None, {
                iconId: 'settings-gear',
                command: { command: 'kanpan.openSettings', title: '打开设置' },
            }),
        ];
    }
}
exports.SettingsTreeProvider = SettingsTreeProvider;
//# sourceMappingURL=treeProviders.js.map