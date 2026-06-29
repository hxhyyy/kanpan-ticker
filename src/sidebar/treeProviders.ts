import * as vscode from 'vscode';
import { formatChangePercent, formatPrice } from '../providers';
import { getDisplayLabel, MarketStore, marketKeyOf } from '../marketService';

export class KanpanTreeItem extends vscode.TreeItem {
  constructor(
    public readonly nodeId: string,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      description?: string;
      tooltip?: string;
      iconId?: string;
      contextValue?: string;
      command?: vscode.Command;
    }
  ) {
    super(label, collapsibleState);
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

function buildQuoteTreeItem(
  type: 'stock' | 'crypto',
  symbol: string,
  store: MarketStore
): KanpanTreeItem {
  const key = marketKeyOf(type, symbol);
  const cached = store.get(key);
  const displayName = getDisplayLabel(symbol);

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
  const changeText = formatChangePercent(quote.changePercent);
  const priceText = formatPrice(quote.price);
  const iconId = quote.changePercent >= 0 ? 'arrow-up' : 'arrow-down';

  return new KanpanTreeItem(key, `[${displayName}]`, vscode.TreeItemCollapsibleState.None, {
    description: `${changeText}  ${priceText}`,
    tooltip: [
      symbol,
      `现价: ${priceText}`,
      `涨跌: ${changeText}`,
      `开盘: ${formatPrice(quote.open)}`,
      `最高: ${formatPrice(quote.high)}`,
      `最低: ${formatPrice(quote.low)}`,
      `昨收: ${formatPrice(quote.previousClose)}`,
    ].join('\n'),
    iconId,
    contextValue: type === 'stock' ? 'usStock' : 'crypto',
  });
}

export class StockTreeProvider implements vscode.TreeDataProvider<KanpanTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<KanpanTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly store: MarketStore) {
    store.onUpdate(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: KanpanTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: KanpanTreeItem): KanpanTreeItem[] {
    const config = vscode.workspace.getConfiguration('kanpan');
    const stocks = config.get<string[]>('stocks', ['AAPL', 'NVDA', 'TSLA']).map((s) => s.toUpperCase());

    if (!element) {
      const count = stocks.length;
      return [
        new KanpanTreeItem(
          'us-group',
          `US Stock(${count})`,
          stocks.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
          { contextValue: 'stockGroup', iconId: 'graph' }
        ),
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

export class CryptoTreeProvider implements vscode.TreeDataProvider<KanpanTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<KanpanTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly store: MarketStore) {
    store.onUpdate(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: KanpanTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: KanpanTreeItem): KanpanTreeItem[] {
    const config = vscode.workspace.getConfiguration('kanpan');
    const symbols = config.get<string[]>('cryptoSymbols', ['BTCUSDT']).map((s) => s.toUpperCase());

    if (!element) {
      const count = symbols.length;
      return [
        new KanpanTreeItem(
          'crypto-group',
          `Crypto(${count})`,
          symbols.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
          { contextValue: 'cryptoGroup', iconId: 'symbol-bitcoin' }
        ),
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

export class SettingsTreeProvider implements vscode.TreeDataProvider<KanpanTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<KanpanTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: KanpanTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): KanpanTreeItem[] {
    return [
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
