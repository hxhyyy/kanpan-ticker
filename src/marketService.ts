import * as vscode from 'vscode';
import {
  defaultSymbolLabel,
  fetchCryptoQuote,
  formatChangePercent,
  formatPrice,
  QuoteData,
  renderFormat,
} from './providers';
import {
  fetchStockQuoteBySource,
  formatQuoteTooltip,
  getStockSourceLabel,
  StockDataSourceId,
  STOCK_SOURCE_OPTIONS,
} from './stockSources';
import {
  AMBIGUOUS_BARE_CODES,
  fetchAShareQuote,
  isAShareCodeInput,
  isAmbiguousBareCode,
  normalizeAShareCode,
  searchAShare,
} from './aShareSources';
import {
  applyStatusBarItemColors,
  clearStatusBarItemColors,
  getRiseFallColors,
  shouldUseNeutralColors,
} from './colorSettings';
import {
  indexInWatchList,
  readWatchList,
  reorderList,
  writeWatchList,
} from './sidebar/reorder';
import { sessionLabel } from './session';
import { fetchVolumeStats } from './volumeStats';

export type MarketType = 'stock' | 'crypto' | 'ashare';

export interface MarketKey {
  type: MarketType;
  symbol: string;
}

export function marketKeyOf(type: MarketType, symbol: string): string {
  if (type === 'ashare') {
    return `${type}:${normalizeAShareCode(symbol)}`;
  }
  return `${type}:${symbol.toUpperCase()}`;
}

export function parseMarketKey(key: string): MarketKey {
  const colon = key.indexOf(':');
  const type = key.slice(0, colon) as MarketType;
  const symbol = key.slice(colon + 1);
  return {
    type,
    symbol: type === 'ashare' ? symbol.toLowerCase() : symbol.toUpperCase(),
  };
}

interface CachedEntry {
  quote?: QuoteData;
  error?: string;
}

export function getConfig() {
  return vscode.workspace.getConfiguration('kanpan');
}

const STOCK_SOURCE_STATE_KEY = 'stockDataSource';
const STATUS_BAR_ITEMS_STATE_KEY = 'statusBarItems';

export function getStatusBarItems(context: vscode.ExtensionContext): string[] {
  const fromState = context.globalState.get<string[]>(STATUS_BAR_ITEMS_STATE_KEY);
  const items =
    fromState && fromState.length > 0 ? fromState : getConfig().get<string[]>('statusBarItems', []);
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

export async function setStatusBarItems(
  context: vscode.ExtensionContext,
  items: string[]
): Promise<void> {
  const normalized = items.map((k) => {
    const colon = k.indexOf(':');
    if (colon < 0) {
      return k;
    }
    const type = k.slice(0, colon);
    const symbol = k.slice(colon + 1);
    if (type === 'ashare') {
      return `${type}:${normalizeAShareCode(symbol)}`;
    }
    return `${type}:${symbol.toUpperCase()}`;
  });
  await context.globalState.update(STATUS_BAR_ITEMS_STATE_KEY, normalized);
  try {
    await getConfig().update('statusBarItems', normalized, vscode.ConfigurationTarget.Global);
  } catch {
    // ignore
  }
}

export function isInStatusBar(context: vscode.ExtensionContext, key: string): boolean {
  return getStatusBarItems(context).includes(key);
}

export function getStockDataSource(context: vscode.ExtensionContext): StockDataSourceId {
  const fromState = context.globalState.get<StockDataSourceId>(STOCK_SOURCE_STATE_KEY);
  if (fromState) {
    return fromState;
  }
  return getConfig().get<StockDataSourceId>('stockDataSource', 'auto');
}

export async function setStockDataSource(
  context: vscode.ExtensionContext,
  source: StockDataSourceId
): Promise<void> {
  await context.globalState.update(STOCK_SOURCE_STATE_KEY, source);
  try {
    await getConfig().update('stockDataSource', source, vscode.ConfigurationTarget.Global);
  } catch {
    // 旧版 manifest 未注册该配置时，globalState 仍可保存选择
  }
}

export function getDisplayLabel(symbol: string, name?: string): string {
  if (name) {
    return name;
  }
  const aliases = getConfig().get<Record<string, string>>('aliases', {});
  return aliases[symbol] ?? defaultSymbolLabel(symbol);
}

export class MarketStore {
  private readonly cache = new Map<string, CachedEntry>();
  private readonly volumeStatsCache = new Map<string, { stats: Awaited<ReturnType<typeof fetchVolumeStats>>; fetchedAt: number }>();
  private readonly listeners = new Set<() => void>();

  private static readonly VOLUME_STATS_TTL_MS = 30 * 60 * 1000;

  onUpdate(listener: () => void): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  get(key: string): CachedEntry | undefined {
    return this.cache.get(key);
  }

  setQuote(key: string, quote: QuoteData): void {
    this.cache.set(key, { quote });
  }

  async enrichQuoteWithVolumeStats(type: MarketType, symbol: string, quote: QuoteData): Promise<QuoteData> {
    const key = marketKeyOf(type, symbol);
    const now = Date.now();
    const cached = this.volumeStatsCache.get(key);
    let stats = cached && now - cached.fetchedAt < MarketStore.VOLUME_STATS_TTL_MS ? cached.stats : undefined;

    if (!stats) {
      try {
        stats = await fetchVolumeStats(type, symbol);
        this.volumeStatsCache.set(key, { stats, fetchedAt: now });
      } catch {
        stats = undefined;
      }
    }

    if (!stats) {
      return quote;
    }

    return {
      ...quote,
      avgVolume5: stats.avg5,
      avgVolume20: stats.avg20,
      latestVolume: stats.latestVolume,
    };
  }

  setError(key: string, error: string): void {
    this.cache.set(key, { error });
  }

  notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export class MarketService {
  private stockTimer: NodeJS.Timeout | undefined;
  private cryptoTimer: NodeJS.Timeout | undefined;
  private statusVisible = true;
  private statusItems: Array<{
    key: string;
    type: MarketType;
    symbol: string;
    statusBarItem: vscode.StatusBarItem;
  }> = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly store: MarketStore
  ) {}

  start(): void {
    void this.ensureStatusBarDefaults().then(() => {
      this.rebuildStatusItems();
      this.scheduleRefresh();
    });
  }

  setStatusVisible(visible: boolean): void {
    this.statusVisible = visible;
    for (const item of this.statusItems) {
      item.statusBarItem.hide();
    }
    if (visible) {
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    await Promise.all([this.refreshStocks(), this.refreshCrypto()]);
  }

  async refreshStocks(): Promise<void> {
    const config = getConfig();
    if (config.get<boolean>('onlyRefreshWhenFocused', false) && !vscode.window.state.focused) {
      return;
    }

    this.rebuildStatusItemsIfNeeded();

    const stocks = config.get<string[]>('stocks', ['AAPL', 'NVDA', 'TSLA']).map((s) => s.toUpperCase());
    const aShares = config.get<string[]>('aShares', ['sh600519', 'sz300750']).map((s) => normalizeAShareCode(s));

    await Promise.all([
      ...stocks.map((symbol) => this.fetchAndCache('stock', symbol)),
      ...aShares.map((symbol) => this.fetchAndCache('ashare', symbol)),
    ]);
    this.store.notify();
    this.updateStatusBar(config);
  }

  async refreshCrypto(): Promise<void> {
    const config = getConfig();
    if (config.get<boolean>('onlyRefreshWhenFocused', false) && !vscode.window.state.focused) {
      return;
    }

    this.rebuildStatusItemsIfNeeded();

    const cryptoSymbols = config
      .get<string[]>('cryptoSymbols', ['BTCUSDT'])
      .map((s) => s.toUpperCase());
    await Promise.all(cryptoSymbols.map((symbol) => this.fetchAndCache('crypto', symbol)));
    this.store.notify();
    this.updateStatusBar(config);
  }

  async addStock(): Promise<void> {
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

    const stocks = getConfig().get<string[]>('stocks', []);
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

  async addCrypto(): Promise<void> {
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

    const symbols = getConfig().get<string[]>('cryptoSymbols', []);
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

  async addAShare(): Promise<void> {
    const input = await vscode.window.showInputBox({
      prompt: '输入 A 股代码或中文名称，如 600519、贵州茅台、茅台',
      placeHolder: '600519 或 贵州茅台',
      validateInput: (value) => (value.trim() ? undefined : '不能为空'),
    });
    if (!input) {
      return;
    }

    const trimmed = input.trim();
    let code: string;
    let displayName: string | undefined;

    if (isAShareCodeInput(trimmed)) {
      if (isAmbiguousBareCode(trimmed)) {
        const bare = trimmed.padStart(6, '0');
        const options = AMBIGUOUS_BARE_CODES[bare] ?? [];
        const picked = await vscode.window.showQuickPick(
          options.map((item) => ({
            label: item.name,
            description: item.code,
            code: item.code,
          })),
          { placeHolder: `「${bare}」对应多个标的，请选择` }
        );
        if (!picked) {
          return;
        }
        code = picked.code;
        displayName = picked.label;
      } else {
        try {
          code = normalizeAShareCode(trimmed);
        } catch (error) {
          vscode.window.showErrorMessage(error instanceof Error ? error.message : '无效的 A 股代码');
          return;
        }
      }
    } else {
      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在搜索「${trimmed}」...`,
        },
        () => searchAShare(trimmed)
      );

      if (results.length === 0) {
        vscode.window.showWarningMessage(`未找到与「${trimmed}」匹配的 A 股`);
        return;
      }

      if (results.length === 1) {
        code = results[0].code;
        displayName = results[0].name;
      } else {
        const picked = await vscode.window.showQuickPick(
          results.map((item) => ({
            label: item.name,
            description: [item.code.slice(2), item.typeName].filter(Boolean).join(' · '),
            detail: item.code,
            code: item.code,
          })),
          {
            placeHolder: `选择「${trimmed}」的匹配结果`,
            matchOnDescription: true,
            matchOnDetail: true,
          }
        );
        if (!picked) {
          return;
        }
        code = picked.code;
        displayName = picked.label;
      }
    }

    const aShares = getConfig().get<string[]>('aShares', []);
    if (aShares.map((s) => normalizeAShareCode(s)).includes(code)) {
      vscode.window.showInformationMessage(`${displayName ?? code} 已在列表中`);
      return;
    }

    await getConfig().update('aShares', [...aShares, code], vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`已添加 A 股 ${displayName ?? code}`);
    this.start();
    void this.refresh();
  }

  async removeStock(symbol: string): Promise<void> {
    const key = marketKeyOf('stock', symbol);
    const stocks = getConfig().get<string[]>('stocks', []);
    await getConfig().update(
      'stocks',
      stocks.filter((s) => s.toUpperCase() !== symbol.toUpperCase()),
      vscode.ConfigurationTarget.Global
    );
    await setStatusBarItems(
      this.context,
      getStatusBarItems(this.context).filter((item) => item !== key)
    );
    this.start();
    void this.refresh();
  }

  async removeCrypto(symbol: string): Promise<void> {
    const key = marketKeyOf('crypto', symbol);
    const symbols = getConfig().get<string[]>('cryptoSymbols', []);
    await getConfig().update(
      'cryptoSymbols',
      symbols.filter((s) => s.toUpperCase() !== symbol.toUpperCase()),
      vscode.ConfigurationTarget.Global
    );
    await setStatusBarItems(
      this.context,
      getStatusBarItems(this.context).filter((item) => item !== key)
    );
    this.start();
    void this.refresh();
  }

  async removeAShare(symbol: string): Promise<void> {
    const code = normalizeAShareCode(symbol);
    const key = marketKeyOf('ashare', code);
    const aShares = getConfig().get<string[]>('aShares', []);
    await getConfig().update(
      'aShares',
      aShares.filter((s) => normalizeAShareCode(s) !== code),
      vscode.ConfigurationTarget.Global
    );
    await setStatusBarItems(
      this.context,
      getStatusBarItems(this.context).filter((item) => item !== key)
    );
    this.start();
    void this.refresh();
  }

  async reorderWatchItem(sourceNodeId: string, targetNodeId: string): Promise<boolean> {
    const source = parseMarketKey(sourceNodeId);
    const target = parseMarketKey(targetNodeId);
    if (source.type !== target.type) {
      return false;
    }

    const list = readWatchList(source.type);
    const fromIndex = indexInWatchList(source.type, source.symbol, list);
    const toIndex = indexInWatchList(target.type, target.symbol, list);
    const next = reorderList(list, fromIndex, toIndex);
    if (!next) {
      return false;
    }

    await writeWatchList(source.type, next);
    this.start();
    void this.refresh();
    return true;
  }

  async moveWatchItem(nodeId: string, direction: 'up' | 'down'): Promise<boolean> {
    const parsed = parseMarketKey(nodeId);
    const list = readWatchList(parsed.type);
    const index = indexInWatchList(parsed.type, parsed.symbol, list);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const next = reorderList(list, index, targetIndex);
    if (!next) {
      return false;
    }

    await writeWatchList(parsed.type, next);
    this.start();
    void this.refresh();
    return true;
  }

  async selectStockSource(): Promise<void> {
    const current = getStockDataSource(this.context);
    const picked = await vscode.window.showQuickPick(
      STOCK_SOURCE_OPTIONS.map((option) => ({
        label: option.id === current ? `$(check) ${option.label}` : option.label,
        description: option.description,
        detail: option.needsApiKey ? '需要 Finnhub API Key' : '无需 API Key',
        id: option.id,
      })),
      {
        placeHolder: '选择美股数据源',
        title: '看盘插件 - 美股数据源',
      }
    );

    if (!picked) {
      return;
    }

    await setStockDataSource(this.context, picked.id);
    vscode.window.showInformationMessage(`美股数据源已切换为：${getStockSourceLabel(picked.id)}`);
    void this.refresh();
  }

  getCurrentStockSourceLabel(): string {
    return getStockSourceLabel(getStockDataSource(this.context));
  }

  async addToStatusBar(key: string): Promise<void> {
    const colon = key.indexOf(':');
    if (colon < 0) {
      return;
    }
    const type = key.slice(0, colon);
    if (type !== 'stock' && type !== 'crypto' && type !== 'ashare') {
      return;
    }
    const normalized = marketKeyOf(type as MarketType, key.slice(colon + 1));

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

  async removeFromStatusBar(key: string): Promise<void> {
    const items = getStatusBarItems(this.context);
    if (!items.includes(key)) {
      return;
    }

    await setStatusBarItems(
      this.context,
      items.filter((item) => item !== key)
    );
    const label = getDisplayLabel(key.split(':')[1]);
    vscode.window.showInformationMessage(`已从状态栏移除 ${label}`);
    this.rebuildStatusItems();
    void this.refresh();
  }

  async ensureStatusBarDefaults(): Promise<void> {
    const items = getStatusBarItems(this.context);
    if (items.length > 0) {
      return;
    }

    const config = getConfig();
    const defaults = [
      ...config.get<string[]>('stocks', ['AAPL', 'NVDA', 'TSLA']).map((s) => marketKeyOf('stock', s)),
      ...config.get<string[]>('aShares', ['sh600519', 'sz300750']).map((s) => marketKeyOf('ashare', s)),
      ...config.get<string[]>('cryptoSymbols', ['BTCUSDT']).map((s) => marketKeyOf('crypto', s)),
    ];
    if (defaults.length > 0) {
      await setStatusBarItems(this.context, defaults);
    }
  }

  private async fetchAndCache(type: MarketType, symbol: string): Promise<void> {
    const key = marketKeyOf(type, symbol);
    try {
      const quote =
        type === 'stock'
          ? await fetchStockQuoteBySource(
              symbol,
              getStockDataSource(this.context),
              getConfig().get<string>('finnhubApiKey', ''),
              getConfig().get<string[]>('autoFallbackOrder', [
                'eastmoney',
                'sina',
                'tencent',
                'finnhubExtended',
                'finnhub',
              ])
            )
          : type === 'ashare'
            ? await fetchAShareQuote(symbol)
            : await fetchCryptoQuote(symbol);
      const enriched = await this.store.enrichQuoteWithVolumeStats(type, symbol, quote);
      this.store.setQuote(key, enriched);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.setError(key, message);
    }
  }

  private updateStatusBar(config: vscode.WorkspaceConfiguration): void {
    if (!this.statusVisible || !config.get<boolean>('enabled', true)) {
      for (const item of this.statusItems) {
        item.statusBarItem.hide();
      }
      return;
    }

    const monochrome = shouldUseNeutralColors(config);
    const showChangePercent = config.get<boolean>('showChangePercent', true);
    const { rise: riseColor, fall: fallColor } = getRiseFallColors(config);
    const format = config.get<string>('format', '{symbol} {price} {change} {icon}');

    for (const item of this.statusItems) {
      const cached = this.store.get(item.key);
      const label = getDisplayLabel(item.symbol, cached?.quote?.name);

      if (cached?.error) {
        item.statusBarItem.text = `$(warning) ${label}`;
        item.statusBarItem.tooltip = `${item.symbol}: ${cached.error}`;
        clearStatusBarItemColors(item.statusBarItem);
        item.statusBarItem.show();
        continue;
      }

      if (!cached?.quote) {
        item.statusBarItem.text = `$(sync~spin) ${label}`;
        item.statusBarItem.tooltip = `${item.symbol}: 加载中...`;
        clearStatusBarItemColors(item.statusBarItem);
        item.statusBarItem.show();
        continue;
      }

      const quote = cached.quote;
      const priceText = formatPrice(quote.price);
      const changeText = formatChangePercent(quote.changePercent);

      item.statusBarItem.text = showChangePercent
        ? renderFormat(format, label, quote.price, quote.changePercent, !monochrome)
        : `${label} ${priceText}`;

      applyStatusBarItemColors(item.statusBarItem, quote.changePercent, monochrome, riseColor, fallColor);

      item.statusBarItem.tooltip = [
        formatQuoteTooltip(quote),
        '',
        '点击刷新',
      ].join('\n');
      item.statusBarItem.show();
    }
  }

  private rebuildStatusItemsIfNeeded(): void {
    const statusKeys = getStatusBarItems(this.context);
    const position = getConfig().get<string>('statusBarPosition', 'left');
    const keysMatch = statusKeys.join('|') === this.statusItems.map((i) => i.key).join('|');
    if (!keysMatch || this.lastStatusBarPosition !== position) {
      this.lastStatusBarPosition = position;
      this.rebuildStatusItems();
    }
  }

  private rebuildStatusItems(): void {
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

  private lastStatusBarPosition: string | undefined;

  private getStatusBarAlignment(): vscode.StatusBarAlignment {
    const position = getConfig().get<string>('statusBarPosition', 'left');
    return position === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
  }

  private createStatusItem(type: MarketType, symbol: string, priority: number) {
    const statusBarItem = vscode.window.createStatusBarItem(this.getStatusBarAlignment(), priority);
    statusBarItem.command = 'kanpan.refresh';
    this.context.subscriptions.push(statusBarItem);
    return { key: marketKeyOf(type, symbol), type, symbol, statusBarItem };
  }

  private scheduleRefresh(): void {
    if (this.stockTimer) {
      clearInterval(this.stockTimer);
    }
    if (this.cryptoTimer) {
      clearInterval(this.cryptoTimer);
    }

    const stockInterval = Math.max(getConfig().get<number>('stockRefreshInterval', 2000), 1000);
    const cryptoInterval = Math.max(getConfig().get<number>('cryptoRefreshInterval', 1000), 1000);

    void this.refreshStocks();
    void this.refreshCrypto();

    this.stockTimer = setInterval(() => void this.refreshStocks(), stockInterval);
    this.cryptoTimer = setInterval(() => void this.refreshCrypto(), cryptoInterval);
  }
}
