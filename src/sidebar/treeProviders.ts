import * as vscode from 'vscode';
import { coloredTrendIcon, getColorSchemeLabel, getRiseFallColors, shouldUseNeutralColors } from '../colorSettings';
import { quoteDecorationUri } from '../quoteDecoration';
import { formatChangePercent, formatPrice } from '../providers';
import { normalizeAShareCode } from '../aShareSources';
import { getDisplayLabel, getConfig, getStockDataSource, getStatusBarItems, MarketStore, marketKeyOf, MarketType } from '../marketService';
import { sessionLabel } from '../session';
import { formatQuoteTooltip, getStockSourceLabel } from '../stockSources';

let extensionContext: vscode.ExtensionContext | undefined;

export function bindExtensionContext(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

function currentStockSourceLabel(): string {
  if (!extensionContext) {
    return getStockSourceLabel('auto');
  }
  return getStockSourceLabel(getStockDataSource(extensionContext));
}

export class KanpanTreeItem extends vscode.TreeItem {
  constructor(
    public readonly nodeId: string,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      description?: string;
      tooltip?: string;
      iconId?: string;
      iconPath?: vscode.Uri | vscode.ThemeIcon;
      resourceUri?: vscode.Uri;
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
    if (options?.iconPath) {
      this.iconPath = options.iconPath;
    } else if (options?.iconId) {
      this.iconPath = new vscode.ThemeIcon(options.iconId);
    }
    if (options?.resourceUri) {
      this.resourceUri = options.resourceUri;
    }
    if (options?.contextValue) {
      this.contextValue = options.contextValue;
    }
    if (options?.command) {
      this.command = options.command;
    }
  }
}

function getContextValue(type: MarketType, inStatusBar: boolean): string {
  if (type === 'stock') {
    return inStatusBar ? 'usStockPinned' : 'usStock';
  }
  if (type === 'ashare') {
    return inStatusBar ? 'aStockPinned' : 'aStock';
  }
  return inStatusBar ? 'cryptoPinned' : 'crypto';
}

function buildQuoteTreeItem(type: MarketType, symbol: string, store: MarketStore): KanpanTreeItem {
  const key = marketKeyOf(type, symbol);
  const cached = store.get(key);
  const displayName = getDisplayLabel(symbol, cached?.quote?.name);
  const inStatusBar = extensionContext ? getStatusBarItems(extensionContext).includes(key) : false;
  const contextValue = getContextValue(type, inStatusBar);
  const pinPrefix = inStatusBar ? '$(pin) ' : '';

  if (cached?.error) {
    return new KanpanTreeItem(key, `${pinPrefix}[${displayName}]`, vscode.TreeItemCollapsibleState.None, {
      description: '加载失败',
      tooltip: `${symbol}\n${cached.error}${inStatusBar ? '\n已在状态栏显示' : '\n右键可添加到状态栏'}`,
      iconId: 'warning',
      contextValue,
    });
  }

  if (!cached?.quote) {
    return new KanpanTreeItem(key, `${pinPrefix}[${displayName}]`, vscode.TreeItemCollapsibleState.None, {
      description: '加载中...',
      tooltip: symbol,
      iconId: 'sync~spin',
      contextValue,
    });
  }

  const quote = cached.quote;
  const changeText = formatChangePercent(quote.changePercent);
  const priceText = formatPrice(quote.price);
  const monochrome = shouldUseNeutralColors();
  const showChangePercent = getConfig().get<boolean>('showChangePercent', true);
  const { rise, fall } = getRiseFallColors();
  const up = quote.changePercent >= 0;
  const trendColor = up ? rise : fall;
  const iconPath = monochrome
    ? new vscode.ThemeIcon(up ? 'arrow-up' : 'arrow-down')
    : coloredTrendIcon(up, trendColor);
  const sessionText = quote.session ? sessionLabel(quote.session) : '';

  const descParts: string[] = [];
  if (showChangePercent) {
    descParts.push(changeText);
  }
  descParts.push(priceText);
  if (sessionText && type !== 'ashare') {
    descParts.push(sessionText);
  }

  const decorationUri =
    showChangePercent && !monochrome ? quoteDecorationUri(key, quote.changePercent) : undefined;

  return new KanpanTreeItem(key, `${pinPrefix}[${displayName}]`, vscode.TreeItemCollapsibleState.None, {
    description: descParts.join('  '),
    tooltip: [formatQuoteTooltip(quote), inStatusBar ? '已在状态栏显示' : '右键 → 添加到状态栏', '可拖拽调整顺序'].join('\n'),
    iconPath,
    resourceUri: decorationUri,
    contextValue,
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
    const config = getConfig();
    const stocks = config.get<string[]>('stocks', ['AAPL', 'NVDA', 'TSLA']).map((s) => s.toUpperCase());
    const aShares = config.get<string[]>('aShares', ['sh600519', 'sz300750']).map((s) => normalizeAShareCode(s));
    const source = currentStockSourceLabel();

    if (!element) {
      return [
        new KanpanTreeItem(
          'us-group',
          `US Stock(${stocks.length})`,
          stocks.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
          {
            contextValue: 'stockGroup',
            iconId: 'graph',
            description: source,
            tooltip: `当前数据源: ${source}\n悬停此行点击 + 添加美股`,
          }
        ),
        new KanpanTreeItem(
          'a-group',
          `A Stock(${aShares.length})`,
          aShares.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
          {
            contextValue: 'aStockGroup',
            iconId: 'symbol-ruler',
            description: '新浪财经',
            tooltip: 'A 股行情来自新浪财经\n悬停此行点击 + 添加 A 股',
          }
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

    if (element.nodeId === 'a-group') {
      if (aShares.length === 0) {
        return [
          new KanpanTreeItem('empty-ashare', '暂无 A 股，点击 + 添加', vscode.TreeItemCollapsibleState.None, {
            iconId: 'info',
          }),
        ];
      }
      return aShares.map((symbol) => buildQuoteTreeItem('ashare', symbol, this.store));
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
          { contextValue: 'cryptoGroup', iconId: 'symbol-bitcoin', description: 'Binance' }
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
    const source = currentStockSourceLabel();
    const { scheme, rise, fall } = getRiseFallColors();

    const items: KanpanTreeItem[] = [
      new KanpanTreeItem('settings-color-scheme', '涨跌颜色方案', vscode.TreeItemCollapsibleState.None, {
        iconId: 'symbol-color',
        description: getColorSchemeLabel(scheme),
        tooltip: '美国惯例：绿涨红跌\n中国惯例：红涨绿跌\n无颜色：涨跌不着色\n也可选手动自定义',
        command: { command: 'kanpan.selectColorScheme', title: '选择涨跌颜色' },
      }),
    ];

    if (scheme === 'custom') {
      items.push(
        new KanpanTreeItem('settings-rise-color', '上涨颜色', vscode.TreeItemCollapsibleState.None, {
          iconId: 'arrow-up',
          description: rise,
          command: { command: 'kanpan.setRiseColor', title: '设置上涨颜色' },
        }),
        new KanpanTreeItem('settings-fall-color', '下跌颜色', vscode.TreeItemCollapsibleState.None, {
          iconId: 'arrow-down',
          description: fall,
          command: { command: 'kanpan.setFallColor', title: '设置下跌颜色' },
        })
      );
    }

    items.push(
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
      new KanpanTreeItem('settings-add-ashare', '添加 A 股', vscode.TreeItemCollapsibleState.None, {
        iconId: 'add',
        command: { command: 'kanpan.addAShare', title: '添加 A 股' },
      }),
      new KanpanTreeItem('settings-add-crypto', '添加加密货币', vscode.TreeItemCollapsibleState.None, {
        iconId: 'add',
        command: { command: 'kanpan.addCrypto', title: '添加加密货币' },
      }),
      new KanpanTreeItem('settings-open', '打开设置', vscode.TreeItemCollapsibleState.None, {
        iconId: 'settings-gear',
        command: { command: 'kanpan.openSettings', title: '打开设置' },
      })
    );

    return items;
  }
}
