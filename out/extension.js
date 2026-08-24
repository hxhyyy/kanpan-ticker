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
const fs = __importStar(require("fs"));
const vscode = __importStar(require("vscode"));
const colorSettings_1 = require("./colorSettings");
const marketService_1 = require("./marketService");
const providers_1 = require("./providers");
const quoteDecoration_1 = require("./quoteDecoration");
const readerService_1 = require("./reader/readerService");
const readerWebview_1 = require("./reader/readerWebview");
const reorder_1 = require("./sidebar/reorder");
const readerTreeProvider_1 = require("./sidebar/readerTreeProvider");
const treeProviders_1 = require("./sidebar/treeProviders");
const priceAlerts_1 = require("./priceAlerts");
const stealthNotify_1 = require("./stealthNotify");
const BINANCE_PAIRS_STORAGE_KEY = 'kanpan.binanceTradingPairs';
async function moveItem(item, direction, marketService, refresh) {
    if (!item?.nodeId) {
        return;
    }
    const moved = await marketService.moveWatchItem(item.nodeId, direction);
    if (moved) {
        refresh();
    }
}
async function activate(context) {
    (0, treeProviders_1.bindExtensionContext)(context);
    (0, stealthNotify_1.initStealthNotify)(context);
    await (0, colorSettings_1.initKanpanThemeColors)();
    (0, providers_1.initBinancePairsCache)(context.globalState.get(BINANCE_PAIRS_STORAGE_KEY), (snapshot) => {
        void context.globalState.update(BINANCE_PAIRS_STORAGE_KEY, snapshot);
    });
    (0, providers_1.prefetchBinanceTradingPairs)();
    const store = new marketService_1.MarketStore();
    const marketService = new marketService_1.MarketService(context, store);
    const readerService = new readerService_1.ReaderService(context);
    const quoteDecoration = new quoteDecoration_1.QuoteDecorationProvider();
    const stockProvider = new treeProviders_1.StockTreeProvider(store);
    const cryptoProvider = new treeProviders_1.CryptoTreeProvider(store);
    const readerProvider = new readerTreeProvider_1.ReaderTreeProvider(readerService);
    const readerWebview = new readerWebview_1.ReaderWebviewProvider(readerService);
    const settingsProvider = new treeProviders_1.SettingsTreeProvider();
    const refreshStockView = () => stockProvider.refresh();
    const refreshCryptoView = () => cryptoProvider.refresh();
    const stockView = vscode.window.createTreeView('kanpanView.stock', {
        treeDataProvider: stockProvider,
        dragAndDropController: (0, reorder_1.createStockDragController)((source, target) => marketService.reorderWatchItem(source, target), refreshStockView),
    });
    const cryptoView = vscode.window.createTreeView('kanpanView.crypto', {
        treeDataProvider: cryptoProvider,
        dragAndDropController: (0, reorder_1.createCryptoDragController)((source, target) => marketService.reorderWatchItem(source, target), refreshCryptoView),
    });
    const readerView = vscode.window.createTreeView('kanpanView.reader', {
        treeDataProvider: readerProvider,
    });
    context.subscriptions.push(quoteDecoration, stockView, cryptoView, readerView, readerService, vscode.window.registerWebviewViewProvider(readerWebview_1.ReaderWebviewProvider.viewType, readerWebview, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.window.registerFileDecorationProvider(quoteDecoration), store.onUpdate(() => quoteDecoration.refresh()), vscode.window.registerTreeDataProvider('kanpanView.settings', settingsProvider), vscode.commands.registerCommand('kanpan.refresh', async () => {
        await marketService.refresh();
        stockProvider.refresh();
        cryptoProvider.refresh();
    }), vscode.commands.registerCommand('kanpan.show', () => marketService.setStatusVisible(true)), vscode.commands.registerCommand('kanpan.hide', () => marketService.setStatusVisible(false)), vscode.commands.registerCommand('kanpan.peekStatusBar', () => marketService.peekStatusBar()), vscode.commands.registerCommand('kanpan.toggleStatusBarDisplayMode', () => marketService.toggleStatusBarDisplayMode()), vscode.commands.registerCommand('kanpan.togglePriceAlertsMute', () => marketService.togglePriceAlertsMute()), vscode.commands.registerCommand('kanpan.addStock', () => marketService.addStock()), vscode.commands.registerCommand('kanpan.addAShare', async () => {
        await marketService.addAShare();
        stockProvider.refresh();
    }), vscode.commands.registerCommand('kanpan.addCrypto', () => marketService.addCrypto()), vscode.commands.registerCommand('kanpan.moveUp', async (item) => {
        await moveItem(item, 'up', marketService, () => {
            stockProvider.refresh();
            cryptoProvider.refresh();
        });
    }), vscode.commands.registerCommand('kanpan.moveDown', async (item) => {
        await moveItem(item, 'down', marketService, () => {
            stockProvider.refresh();
            cryptoProvider.refresh();
        });
    }), vscode.commands.registerCommand('kanpan.removeStock', async (item) => {
        const symbol = item?.nodeId?.slice(item.nodeId.indexOf(':') + 1);
        if (symbol) {
            await marketService.removeStock(symbol);
            stockProvider.refresh();
        }
    }), vscode.commands.registerCommand('kanpan.removeAShare', async (item) => {
        const symbol = item?.nodeId?.slice(item.nodeId.indexOf(':') + 1);
        if (symbol) {
            await marketService.removeAShare(symbol);
            stockProvider.refresh();
        }
    }), vscode.commands.registerCommand('kanpan.removeCrypto', async (item) => {
        const symbol = item?.nodeId?.slice(item.nodeId.indexOf(':') + 1);
        if (symbol) {
            await marketService.removeCrypto(symbol);
            cryptoProvider.refresh();
        }
    }), vscode.commands.registerCommand('kanpan.addToStatusBar', async (item) => {
        if (item?.nodeId) {
            await marketService.addToStatusBar(item.nodeId);
            stockProvider.refresh();
            cryptoProvider.refresh();
        }
    }), vscode.commands.registerCommand('kanpan.removeFromStatusBar', async (item) => {
        if (item?.nodeId) {
            await marketService.removeFromStatusBar(item.nodeId);
            stockProvider.refresh();
            cryptoProvider.refresh();
        }
    }), vscode.commands.registerCommand('kanpan.setPriceAlert', async (item) => {
        let key = item?.nodeId;
        if (key?.startsWith('alert-add:')) {
            key = key.slice('alert-add:'.length);
        }
        if (!key || !key.includes(':') || key.startsWith('alert:')) {
            return;
        }
        const cached = store.get(key);
        await (0, priceAlerts_1.createPriceAlert)(context, key, cached?.quote?.price);
        stockProvider.refresh();
        cryptoProvider.refresh();
    }), vscode.commands.registerCommand('kanpan.managePriceAlerts', async (item) => {
        let key = item?.nodeId;
        if (key?.startsWith('alert-add:')) {
            key = key.slice('alert-add:'.length);
        }
        if (key?.startsWith('alert:')) {
            key = undefined;
        }
        const marketKey = key?.includes(':') ? key : undefined;
        await (0, priceAlerts_1.managePriceAlerts)(context, marketKey);
        stockProvider.refresh();
        cryptoProvider.refresh();
    }), vscode.commands.registerCommand('kanpan.managePriceAlertItem', async (item) => {
        const nodeId = item?.nodeId;
        if (!nodeId?.startsWith('alert:')) {
            return;
        }
        const alertId = nodeId.slice('alert:'.length);
        const action = await vscode.window.showQuickPick([
            { label: '启用/停用', action: 'toggle' },
            { label: '删除', action: 'delete' },
        ], { placeHolder: '管理这条价格提醒' });
        if (!action) {
            return;
        }
        if (action.action === 'delete') {
            await (0, priceAlerts_1.deletePriceAlertById)(context, alertId);
            vscode.window.showInformationMessage('已删除提醒');
        }
        else {
            await (0, priceAlerts_1.togglePriceAlertById)(context, alertId);
        }
        stockProvider.refresh();
        cryptoProvider.refresh();
    }), vscode.commands.registerCommand('kanpan.deletePriceAlert', async (item) => {
        const nodeId = item?.nodeId;
        if (!nodeId?.startsWith('alert:')) {
            return;
        }
        await (0, priceAlerts_1.deletePriceAlertById)(context, nodeId.slice('alert:'.length));
        stockProvider.refresh();
        cryptoProvider.refresh();
    }), vscode.commands.registerCommand('kanpan.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'kanpan');
    }), vscode.commands.registerCommand('kanpan.readerOpen', async () => {
        try {
            await readerService.pickAndOpen();
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`打开 EPUB 失败：${msg}`);
        }
    }), vscode.commands.registerCommand('kanpan.readerNext', () => readerService.nextPage(readerService_1.READER_PAGE_SIZE)), vscode.commands.registerCommand('kanpan.readerPrev', () => readerService.prevPage(readerService_1.READER_PAGE_SIZE)), vscode.commands.registerCommand('kanpan.readerClose', () => readerService.closeBook()), vscode.commands.registerCommand('kanpan.readerJumpChapter', async (item) => {
        const nodeId = item?.nodeId;
        if (!nodeId?.startsWith('reader-chapter:')) {
            return;
        }
        const index = Number(nodeId.slice('reader-chapter:'.length));
        if (Number.isFinite(index)) {
            await readerService.jumpToChapter(index);
        }
    }), vscode.commands.registerCommand('kanpan.selectStockSource', async () => {
        await marketService.selectStockSource();
        stockProvider.refresh();
        settingsProvider.refresh();
    }), vscode.commands.registerCommand('kanpan.selectColorScheme', async () => {
        await (0, colorSettings_1.selectColorScheme)();
        stockProvider.refresh();
        cryptoProvider.refresh();
        settingsProvider.refresh();
        quoteDecoration.refresh();
        void marketService.refresh();
    }), vscode.commands.registerCommand('kanpan.setRiseColor', async () => {
        await (0, colorSettings_1.setCustomColor)('rise');
        stockProvider.refresh();
        cryptoProvider.refresh();
        settingsProvider.refresh();
        quoteDecoration.refresh();
        void marketService.refresh();
    }), vscode.commands.registerCommand('kanpan.setFallColor', async () => {
        await (0, colorSettings_1.setCustomColor)('fall');
        stockProvider.refresh();
        cryptoProvider.refresh();
        settingsProvider.refresh();
        quoteDecoration.refresh();
        void marketService.refresh();
    }), vscode.commands.registerCommand('kanpan.setStatusBarBrightness', async () => {
        await (0, colorSettings_1.selectStatusBarBrightness)();
        settingsProvider.refresh();
        void marketService.refresh();
    }), vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('kanpan')) {
            await (0, colorSettings_1.initKanpanThemeColors)();
            marketService.start();
            stockProvider.refresh();
            cryptoProvider.refresh();
            settingsProvider.refresh();
            quoteDecoration.refresh();
        }
    }), vscode.window.onDidChangeWindowState(() => {
        void marketService.refresh();
    }));
    marketService.start();
    await restoreReaderBook(readerService);
}
async function restoreReaderBook(readerService) {
    await readerService.restore();
    if (readerService.currentBook) {
        return;
    }
    const configured = vscode.workspace
        .getConfiguration('kanpan')
        .get('readerDefaultEpub', '')
        .trim();
    if (configured && fs.existsSync(configured)) {
        try {
            await readerService.openBook(configured, { silent: true });
        }
        catch {
            // ignore invalid default path
        }
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map