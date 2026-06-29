import * as vscode from 'vscode';
import { MarketService, MarketStore } from './marketService';
import { bindExtensionContext, CryptoTreeProvider, SettingsTreeProvider, StockTreeProvider } from './sidebar/treeProviders';

export function activate(context: vscode.ExtensionContext): void {
  bindExtensionContext(context);
  const store = new MarketStore();
  const marketService = new MarketService(context, store);

  const stockProvider = new StockTreeProvider(store);
  const cryptoProvider = new CryptoTreeProvider(store);
  const settingsProvider = new SettingsTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kanpanView.stock', stockProvider),
    vscode.window.registerTreeDataProvider('kanpanView.crypto', cryptoProvider),
    vscode.window.registerTreeDataProvider('kanpanView.settings', settingsProvider),
    vscode.commands.registerCommand('kanpan.refresh', async () => {
      await marketService.refresh();
      stockProvider.refresh();
      cryptoProvider.refresh();
    }),
    vscode.commands.registerCommand('kanpan.show', () => marketService.setStatusVisible(true)),
    vscode.commands.registerCommand('kanpan.hide', () => marketService.setStatusVisible(false)),
    vscode.commands.registerCommand('kanpan.addStock', () => marketService.addStock()),
    vscode.commands.registerCommand('kanpan.addCrypto', () => marketService.addCrypto()),
    vscode.commands.registerCommand('kanpan.removeStock', async (item?: { nodeId?: string }) => {
      const symbol = item?.nodeId?.split(':')[1];
      if (symbol) {
        await marketService.removeStock(symbol);
      }
    }),
    vscode.commands.registerCommand('kanpan.removeCrypto', async (item?: { nodeId?: string }) => {
      const symbol = item?.nodeId?.split(':')[1];
      if (symbol) {
        await marketService.removeCrypto(symbol);
      }
    }),
    vscode.commands.registerCommand('kanpan.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'kanpan');
    }),
    vscode.commands.registerCommand('kanpan.selectStockSource', async () => {
      await marketService.selectStockSource();
      stockProvider.refresh();
      settingsProvider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('kanpan')) {
        marketService.start();
        stockProvider.refresh();
        cryptoProvider.refresh();
        settingsProvider.refresh();
      }
    }),
    vscode.window.onDidChangeWindowState(() => {
      void marketService.refresh();
    })
  );

  marketService.start();
}

export function deactivate(): void {}
