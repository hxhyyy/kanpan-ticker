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
const colorSettings_1 = require("./colorSettings");
const marketService_1 = require("./marketService");
const quoteDecoration_1 = require("./quoteDecoration");
const treeProviders_1 = require("./sidebar/treeProviders");
async function activate(context) {
    (0, treeProviders_1.bindExtensionContext)(context);
    await (0, colorSettings_1.initKanpanThemeColors)();
    const store = new marketService_1.MarketStore();
    const marketService = new marketService_1.MarketService(context, store);
    const quoteDecoration = new quoteDecoration_1.QuoteDecorationProvider();
    const stockProvider = new treeProviders_1.StockTreeProvider(store);
    const cryptoProvider = new treeProviders_1.CryptoTreeProvider(store);
    const settingsProvider = new treeProviders_1.SettingsTreeProvider();
    context.subscriptions.push(quoteDecoration, vscode.window.registerFileDecorationProvider(quoteDecoration), store.onUpdate(() => quoteDecoration.refresh()), vscode.window.registerTreeDataProvider('kanpanView.stock', stockProvider), vscode.window.registerTreeDataProvider('kanpanView.crypto', cryptoProvider), vscode.window.registerTreeDataProvider('kanpanView.settings', settingsProvider), vscode.commands.registerCommand('kanpan.refresh', async () => {
        await marketService.refresh();
        stockProvider.refresh();
        cryptoProvider.refresh();
    }), vscode.commands.registerCommand('kanpan.show', () => marketService.setStatusVisible(true)), vscode.commands.registerCommand('kanpan.hide', () => marketService.setStatusVisible(false)), vscode.commands.registerCommand('kanpan.addStock', () => marketService.addStock()), vscode.commands.registerCommand('kanpan.addAShare', async () => {
        await marketService.addAShare();
        stockProvider.refresh();
    }), vscode.commands.registerCommand('kanpan.addCrypto', () => marketService.addCrypto()), vscode.commands.registerCommand('kanpan.removeStock', async (item) => {
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
    }), vscode.commands.registerCommand('kanpan.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'kanpan');
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
}
function deactivate() { }
//# sourceMappingURL=extension.js.map