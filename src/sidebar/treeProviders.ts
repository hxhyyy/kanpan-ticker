import * as vscode from 'vscode';
import {
  coloredTrendIcon,
  getColorSchemeLabel,
  getRiseFallColors,
  getStatusBarBrightness,
  shouldUseNeutralColors,
} from '../colorSettings';
import { quoteDecorationUri } from '../quoteDecoration';
import { formatChangePercent, formatPrice } from '../providers';
import { normalizeAShareCode } from '../aShareSources';
import { getDisplayLabel, getConfig, getStockDataSource, getStatusBarItems, MarketStore, marketKeyOf, MarketType } from '../marketService';
import {
  formatAlertSummary,
  formatAlertTreeDescription,
  formatAlertTreeLabel,
  getAlertsForMarketKey,
  PriceAlert,
} from '../priceAlerts';
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

function isQuoteMarketKey(nodeId: string): boolean {
  return /^(stock|ashare|crypto):/.test(nodeId);
}

function getContextValue(type: MarketType, inStatusBar: boolean, hasAlert: boolean): string {
  let base: string;
  if (type === 'stock') {
    base = inStatusBar ? 'usStockPinned' : 'usStock';
  } else if (type === 'ashare') {
    base = inStatusBar ? 'aStockPinned' : 'aStock';
  } else {
    base = inStatusBar ? 'cryptoPinned' : 'crypto';
  }
  return hasAlert ? `${base}Alert` : base;
}

function buildAlertChildren(marketKey: string): KanpanTreeItem[] {
  const alerts: PriceAlert[] = extensionContext ? getAlertsForMarketKey(extensionContext, marketKey) : [];
  const children: KanpanTreeItem[] = [
    new KanpanTreeItem(`alert-add:${marketKey}`, '添加价格提醒', vscode.TreeItemCollapsibleState.None, {
      iconId: 'bell',
      description: '点击设置',
      tooltip: '在此标的下新增一条价格提醒',
      contextValue: 'priceAlertAdd',
      command: { command: 'kanpan.setPriceAlert', title: '设置价格提醒', arguments: [{ nodeId: marketKey }] },
    }),
  ];

  for (const alert of alerts) {
    children.push(
      new KanpanTreeItem(`alert:${alert.id}`, formatAlertTreeLabel(alert), vscode.TreeItemCollapsibleState.None, {
        iconId: alert.enabled ? 'bell-dot' : 'bell',
        description: formatAlertTreeDescription(alert),
        tooltip: `${formatAlertSummary(alert)}\n点击可启停/删除`,
        contextValue: 'priceAlert',
        command: {
          command: 'kanpan.managePriceAlertItem',
          title: '管理提醒',
          arguments: [{ nodeId: `alert:${alert.id}` }],
        },
      })
    );
  }

  return children;
}

function buildQuoteTreeItem(type: MarketType, symbol: string, store: MarketStore): KanpanTreeItem {
  const key = marketKeyOf(type, symbol);
  const cached = store.get(key);
  const displayName = getDisplayLabel(symbol, cached?.quote?.name);
  const inStatusBar = extensionContext ? getStatusBarItems(extensionContext).includes(key) : false;
  const alerts = extensionContext ? getAlertsForMarketKey(extensionContext, key) : [];
  const activeAlerts = alerts.filter((a) => a.enabled).length;
  const hasAlert = alerts.length > 0;
  const contextValue = getContextValue(type, inStatusBar, hasAlert);
  const pinPrefix = inStatusBar ? '$(pin) ' : '';
  const bellPrefix = hasAlert ? `$(bell-dot) ` : '';
  // 始终可展开：下方直接添加/管理提醒
  const collapsible = vscode.TreeItemCollapsibleState.Collapsed;

  if (cached?.error) {
    return new KanpanTreeItem(key, `${pinPrefix}${bellPrefix}[${displayName}]`, collapsible, {
      description: '加载失败',
      tooltip: `${symbol}\n${cached.error}\n展开可设置价格提醒`,
      iconId: 'warning',
      contextValue,
    });
  }

  if (!cached?.quote) {
    return new KanpanTreeItem(key, `${pinPrefix}${bellPrefix}[${displayName}]`, collapsible, {
      description: '加载中...',
      tooltip: `${symbol}\n展开可设置价格提醒`,
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
  if (hasAlert) {
    descParts.push(activeAlerts > 0 ? `提醒${activeAlerts}` : '提醒(停)');
  }
  if (showChangePercent) {
    descParts.push(changeText);
  }
  descParts.push(priceText);
  if (sessionText && type !== 'ashare') {
    descParts.push(sessionText);
  }

  const decorationUri =
    showChangePercent && !monochrome ? quoteDecorationUri(key, quote.changePercent) : undefined;

  return new KanpanTreeItem(key, `${pinPrefix}${bellPrefix}[${displayName}]`, collapsible, {
    description: descParts.join('  '),
    tooltip: [
      formatQuoteTooltip(quote),
      inStatusBar ? '已在状态栏显示' : '右键 → 添加到状态栏',
      '点击左侧三角展开，可在下方设置/管理价格提醒',
      '可拖拽调整顺序',
    ].join('\n'),
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

    if (isQuoteMarketKey(element.nodeId)) {
      return buildAlertChildren(element.nodeId);
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
          { contextValue: 'cryptoGroup', iconId: 'symbol-bitcoin', description: 'Binance 现货/合约' }
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

    if (isQuoteMarketKey(element.nodeId)) {
      return buildAlertChildren(element.nodeId);
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
    const brightness = getStatusBarBrightness();

    const items: KanpanTreeItem[] = [
      new KanpanTreeItem('settings-color-scheme', '涨跌颜色方案', vscode.TreeItemCollapsibleState.None, {
        iconId: 'symbol-color',
        description: getColorSchemeLabel(scheme),
        tooltip: '美国惯例：绿涨红跌\n中国惯例：红涨绿跌\n无颜色：涨跌不着色\n也可选手动自定义',
        command: { command: 'kanpan.selectColorScheme', title: '选择涨跌颜色' },
      }),
      new KanpanTreeItem(
        'settings-status-brightness',
        '底部字体深浅',
        vscode.TreeItemCollapsibleState.None,
        {
          iconId: 'eye',
          description: `${brightness}%`,
          tooltip: '调整状态栏行情文字深浅（10 最暗，100 最亮）\n档位对齐点亮后的淡出梯度',
          command: { command: 'kanpan.setStatusBarBrightness', title: '设置底部字体深浅' },
        }
      ),
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
