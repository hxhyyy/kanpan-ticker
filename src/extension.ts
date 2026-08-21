import * as vscode from 'vscode';
import { initKanpanThemeColors, selectColorScheme, setCustomColor } from './colorSettings';
import { MarketService, MarketStore } from './marketService';
import {
  BinancePairsSnapshot,
  initBinancePairsCache,
  prefetchBinanceTradingPairs,
} from './providers';
import { QuoteDecorationProvider } from './quoteDecoration';
import { createCryptoDragController, createStockDragController } from './sidebar/reorder';
import { bindExtensionContext, CryptoTreeProvider, SettingsTreeProvider, StockTreeProvider } from './sidebar/treeProviders';
import { createPriceAlert, deletePriceAlertById, managePriceAlerts, togglePriceAlertById } from './priceAlerts';

const BINANCE_PAIRS_STORAGE_KEY = 'kanpan.binanceTradingPairs';

async function moveItem(
  item: { nodeId?: string } | undefined,
  direction: 'up' | 'down',
  marketService: MarketService,
  refresh: () => void
): Promise<void> {
  if (!item?.nodeId) {
    return;
  }
  const moved = await marketService.moveWatchItem(item.nodeId, direction);
  if (moved) {
    refresh();
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  bindExtensionContext(context);
  await initKanpanThemeColors();

  initBinancePairsCache(
    context.globalState.get<BinancePairsSnapshot>(BINANCE_PAIRS_STORAGE_KEY),
    (snapshot) => {
      void context.globalState.update(BINANCE_PAIRS_STORAGE_KEY, snapshot);
    }
  );
  prefetchBinanceTradingPairs();

  const store = new MarketStore();
  const marketService = new MarketService(context, store);
  const quoteDecoration = new QuoteDecorationProvider();

  const stockProvider = new StockTreeProvider(store);
  const cryptoProvider = new CryptoTreeProvider(store);
  const settingsProvider = new SettingsTreeProvider();

  const refreshStockView = () => stockProvider.refresh();
  const refreshCryptoView = () => cryptoProvider.refresh();

  const stockView = vscode.window.createTreeView('kanpanView.stock', {
    treeDataProvider: stockProvider,
    dragAndDropController: createStockDragController(
      (source, target) => marketService.reorderWatchItem(source, target),
      refreshStockView
    ),
  });

  const cryptoView = vscode.window.createTreeView('kanpanView.crypto', {
    treeDataProvider: cryptoProvider,
    dragAndDropController: createCryptoDragController(
      (source, target) => marketService.reorderWatchItem(source, target),
      refreshCryptoView
    ),
  });

  context.subscriptions.push(
    quoteDecoration,
    stockView,
    cryptoView,
    vscode.window.registerFileDecorationProvider(quoteDecoration),
    store.onUpdate(() => quoteDecoration.refresh()),
    vscode.window.registerTreeDataProvider('kanpanView.settings', settingsProvider),
    vscode.commands.registerCommand('kanpan.refresh', async () => {
      await marketService.refresh();
      stockProvider.refresh();
      cryptoProvider.refresh();
    }),
    vscode.commands.registerCommand('kanpan.show', () => marketService.setStatusVisible(true)),
    vscode.commands.registerCommand('kanpan.hide', () => marketService.setStatusVisible(false)),
    vscode.commands.registerCommand('kanpan.peekStatusBar', () => marketService.peekStatusBar()),
    vscode.commands.registerCommand('kanpan.toggleStatusBarDisplayMode', () =>
      marketService.toggleStatusBarDisplayMode()
    ),
    vscode.commands.registerCommand('kanpan.addStock', () => marketService.addStock()),
    vscode.commands.registerCommand('kanpan.addAShare', async () => {
      await marketService.addAShare();
      stockProvider.refresh();
    }),
    vscode.commands.registerCommand('kanpan.addCrypto', () => marketService.addCrypto()),
    vscode.commands.registerCommand('kanpan.moveUp', async (item?: { nodeId?: string }) => {
      await moveItem(item, 'up', marketService, () => {
        stockProvider.refresh();
        cryptoProvider.refresh();
      });
    }),
    vscode.commands.registerCommand('kanpan.moveDown', async (item?: { nodeId?: string }) => {
      await moveItem(item, 'down', marketService, () => {
        stockProvider.refresh();
        cryptoProvider.refresh();
      });
    }),
    vscode.commands.registerCommand('kanpan.removeStock', async (item?: { nodeId?: string }) => {
      const symbol = item?.nodeId?.slice(item.nodeId.indexOf(':') + 1);
      if (symbol) {
        await marketService.removeStock(symbol);
        stockProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('kanpan.removeAShare', async (item?: { nodeId?: string }) => {
      const symbol = item?.nodeId?.slice(item.nodeId.indexOf(':') + 1);
      if (symbol) {
        await marketService.removeAShare(symbol);
        stockProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('kanpan.removeCrypto', async (item?: { nodeId?: string }) => {
      const symbol = item?.nodeId?.slice(item.nodeId.indexOf(':') + 1);
      if (symbol) {
        await marketService.removeCrypto(symbol);
        cryptoProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('kanpan.addToStatusBar', async (item?: { nodeId?: string }) => {
      if (item?.nodeId) {
        await marketService.addToStatusBar(item.nodeId);
        stockProvider.refresh();
        cryptoProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('kanpan.removeFromStatusBar', async (item?: { nodeId?: string }) => {
      if (item?.nodeId) {
        await marketService.removeFromStatusBar(item.nodeId);
        stockProvider.refresh();
        cryptoProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('kanpan.setPriceAlert', async (item?: { nodeId?: string }) => {
      let key = item?.nodeId;
      if (key?.startsWith('alert-add:')) {
        key = key.slice('alert-add:'.length);
      }
      if (!key || !key.includes(':') || key.startsWith('alert:')) {
        return;
      }
      const cached = store.get(key);
      await createPriceAlert(context, key, cached?.quote?.price);
      stockProvider.refresh();
      cryptoProvider.refresh();
    }),
    vscode.commands.registerCommand('kanpan.managePriceAlerts', async (item?: { nodeId?: string }) => {
      let key = item?.nodeId;
      if (key?.startsWith('alert-add:')) {
        key = key.slice('alert-add:'.length);
      }
      if (key?.startsWith('alert:')) {
        key = undefined;
      }
      const marketKey = key?.includes(':') ? key : undefined;
      await managePriceAlerts(context, marketKey);
      stockProvider.refresh();
      cryptoProvider.refresh();
    }),
    vscode.commands.registerCommand('kanpan.managePriceAlertItem', async (item?: { nodeId?: string }) => {
      const nodeId = item?.nodeId;
      if (!nodeId?.startsWith('alert:')) {
        return;
      }
      const alertId = nodeId.slice('alert:'.length);
      const action = await vscode.window.showQuickPick(
        [
          { label: '启用/停用', action: 'toggle' as const },
          { label: '删除', action: 'delete' as const },
        ],
        { placeHolder: '管理这条价格提醒' }
      );
      if (!action) {
        return;
      }
      if (action.action === 'delete') {
        await deletePriceAlertById(context, alertId);
        vscode.window.showInformationMessage('已删除提醒');
      } else {
        await togglePriceAlertById(context, alertId);
      }
      stockProvider.refresh();
      cryptoProvider.refresh();
    }),
    vscode.commands.registerCommand('kanpan.deletePriceAlert', async (item?: { nodeId?: string }) => {
      const nodeId = item?.nodeId;
      if (!nodeId?.startsWith('alert:')) {
        return;
      }
      await deletePriceAlertById(context, nodeId.slice('alert:'.length));
      stockProvider.refresh();
      cryptoProvider.refresh();
    }),
    vscode.commands.registerCommand('kanpan.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'kanpan');
    }),
    vscode.commands.registerCommand('kanpan.selectStockSource', async () => {
      await marketService.selectStockSource();
      stockProvider.refresh();
      settingsProvider.refresh();
    }),
    vscode.commands.registerCommand('kanpan.selectColorScheme', async () => {
      await selectColorScheme();
      stockProvider.refresh();
      cryptoProvider.refresh();
      settingsProvider.refresh();
      quoteDecoration.refresh();
      void marketService.refresh();
    }),
    vscode.commands.registerCommand('kanpan.setRiseColor', async () => {
      await setCustomColor('rise');
      stockProvider.refresh();
      cryptoProvider.refresh();
      settingsProvider.refresh();
      quoteDecoration.refresh();
      void marketService.refresh();
    }),
    vscode.commands.registerCommand('kanpan.setFallColor', async () => {
      await setCustomColor('fall');
      stockProvider.refresh();
      cryptoProvider.refresh();
      settingsProvider.refresh();
      quoteDecoration.refresh();
      void marketService.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('kanpan')) {
        await initKanpanThemeColors();
        marketService.start();
        stockProvider.refresh();
        cryptoProvider.refresh();
        settingsProvider.refresh();
        quoteDecoration.refresh();
      }
    }),
    vscode.window.onDidChangeWindowState(() => {
      void marketService.refresh();
    })
  );

  marketService.start();
}

export function deactivate(): void {}
