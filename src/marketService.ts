import * as vscode from 'vscode';
import {
  defaultSymbolLabel,
  fetchCryptoQuote,
  fetchStockQuote,
  formatChangePercent,
  formatPrice,
  QuoteData,
  renderFormat,
} from './providers';

export type MarketType = 'stock' | 'crypto';

export interface MarketKey {
  type: MarketType;
  symbol: string;
}

export function marketKeyOf(type: MarketType, symbol: string): string {
  return `${type}:${symbol.toUpperCase()}`;
}

export function parseMarketKey(key: string): MarketKey {
  const [type, symbol] = key.split(':');
  return { type: type as MarketType, symbol };
}

interface CachedEntry {
  quote?: QuoteData;
  error?: string;
}

export function getConfig() {
  return vscode.workspace.getConfiguration('kanpan');
}

export function getDisplayLabel(symbol: string): string {
  const aliases = getConfig().get<Record<string, string>>('aliases', {});
  return aliases[symbol] ?? defaultSymbolLabel(symbol);
}

export class MarketStore {
  private readonly cache = new Map<string, CachedEntry>();
  private readonly listeners = new Set<() => void>();

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
  private timer: NodeJS.Timeout | undefined;
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
    this.rebuildStatusItems();
    this.scheduleRefresh();
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
    const config = getConfig();
    const stocks = config.get<string[]>('stocks', ['AAPL', 'NVDA', 'TSLA']).map((s) => s.toUpperCase());
    const cryptoSymbols = config
      .get<string[]>('cryptoSymbols', ['BTCUSDT'])
      .map((s) => s.toUpperCase());

    if (config.get<boolean>('onlyRefreshWhenFocused', false) && !vscode.window.state.focused) {
      return;
    }

    this.rebuildStatusItemsIfNeeded(stocks, cryptoSymbols);

    const tasks: Array<Promise<void>> = [];
    for (const symbol of stocks) {
      tasks.push(this.fetchAndCache('stock', symbol));
    }
    for (const symbol of cryptoSymbols) {
      tasks.push(this.fetchAndCache('crypto', symbol));
    }

    await Promise.all(tasks);
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

  async removeStock(symbol: string): Promise<void> {
    const stocks = getConfig().get<string[]>('stocks', []);
    await getConfig().update(
      'stocks',
      stocks.filter((s) => s.toUpperCase() !== symbol.toUpperCase()),
      vscode.ConfigurationTarget.Global
    );
    this.start();
    void this.refresh();
  }

  async removeCrypto(symbol: string): Promise<void> {
    const symbols = getConfig().get<string[]>('cryptoSymbols', []);
    await getConfig().update(
      'cryptoSymbols',
      symbols.filter((s) => s.toUpperCase() !== symbol.toUpperCase()),
      vscode.ConfigurationTarget.Global
    );
    this.start();
    void this.refresh();
  }

  private async fetchAndCache(type: MarketType, symbol: string): Promise<void> {
    const key = marketKeyOf(type, symbol);
    try {
      const quote =
        type === 'stock'
          ? await fetchStockQuote(symbol, getConfig().get<string>('finnhubApiKey', ''))
          : await fetchCryptoQuote(symbol);
      this.store.setQuote(key, quote);
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

    const monochrome = config.get<boolean>('monochrome', false);
    const showChangePercent = config.get<boolean>('showChangePercent', true);
    const riseColor = config.get<string>('riseColor', '#26a69a');
    const fallColor = config.get<string>('fallColor', '#ef5350');
    const format = config.get<string>('format', '{symbol} {price} {change} {icon}');

    for (const item of this.statusItems) {
      const cached = this.store.get(item.key);
      const label = getDisplayLabel(item.symbol);

      if (cached?.error) {
        item.statusBarItem.text = `$(warning) ${label}`;
        item.statusBarItem.tooltip = `${item.symbol}: ${cached.error}`;
        item.statusBarItem.color = undefined;
        item.statusBarItem.show();
        continue;
      }

      if (!cached?.quote) {
        item.statusBarItem.text = `$(sync~spin) ${label}`;
        item.statusBarItem.tooltip = `${item.symbol}: 加载中...`;
        item.statusBarItem.color = undefined;
        item.statusBarItem.show();
        continue;
      }

      const quote = cached.quote;
      const priceText = formatPrice(quote.price);
      const changeText = formatChangePercent(quote.changePercent);

      item.statusBarItem.text = showChangePercent
        ? renderFormat(format, label, quote.price, quote.changePercent, !monochrome)
        : `${label} ${priceText}`;

      item.statusBarItem.color = monochrome
        ? undefined
        : quote.changePercent >= 0
          ? riseColor
          : fallColor;

      item.statusBarItem.tooltip = [
        quote.symbol,
        `现价: ${priceText}`,
        `涨跌: ${changeText}`,
        `开盘: ${formatPrice(quote.open)}`,
        `最高: ${formatPrice(quote.high)}`,
        `最低: ${formatPrice(quote.low)}`,
        `昨收: ${formatPrice(quote.previousClose)}`,
        '',
        '点击刷新',
      ].join('\n');
      item.statusBarItem.show();
    }
  }

  private rebuildStatusItemsIfNeeded(stocks: string[], cryptoSymbols: string[]): void {
    const expectedKeys = [
      ...stocks.map((s) => marketKeyOf('stock', s)),
      ...cryptoSymbols.map((s) => marketKeyOf('crypto', s)),
    ];
    if (expectedKeys.join('|') !== this.statusItems.map((i) => i.key).join('|')) {
      this.rebuildStatusItems();
    }
  }

  private rebuildStatusItems(): void {
    for (const item of this.statusItems) {
      item.statusBarItem.dispose();
    }
    this.statusItems = [];

    const stocks = getConfig().get<string[]>('stocks', ['AAPL', 'NVDA', 'TSLA']);
    const cryptoSymbols = getConfig().get<string[]>('cryptoSymbols', ['BTCUSDT']);

    let priority = 100;
    for (const symbol of stocks) {
      this.statusItems.push(this.createStatusItem('stock', symbol.toUpperCase(), priority--));
    }
    for (const symbol of cryptoSymbols) {
      this.statusItems.push(this.createStatusItem('crypto', symbol.toUpperCase(), priority--));
    }
  }

  private createStatusItem(type: MarketType, symbol: string, priority: number) {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
    statusBarItem.command = 'kanpan.refresh';
    this.context.subscriptions.push(statusBarItem);
    return { key: marketKeyOf(type, symbol), type, symbol, statusBarItem };
  }

  private scheduleRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    const interval = Math.max(getConfig().get<number>('refreshInterval', 10000), 5000);
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), interval);
  }
}
