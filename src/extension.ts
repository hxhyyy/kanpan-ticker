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

interface TickerItem {
  key: string;
  type: 'stock' | 'crypto';
  symbol: string;
  statusBarItem: vscode.StatusBarItem;
}

function getConfig() {
  return vscode.workspace.getConfiguration('kanpan');
}

class KanpanTicker {
  private items: TickerItem[] = [];
  private timer: NodeJS.Timeout | undefined;
  private visible = true;

  constructor(private readonly context: vscode.ExtensionContext) {}

  start(): void {
    this.disposeItems();
    this.rebuildItems();
    this.scheduleRefresh();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const item of this.items) {
      item.statusBarItem.hide();
    }
    if (visible) {
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    if (!this.visible) {
      return;
    }

    const config = getConfig();
    if (!config.get<boolean>('enabled', true)) {
      for (const item of this.items) {
        item.statusBarItem.hide();
      }
      return;
    }

    if (config.get<boolean>('onlyRefreshWhenFocused', false) && !vscode.window.state.focused) {
      return;
    }

    this.rebuildItemsIfNeeded();

    await Promise.all(
      this.items.map(async (item) => {
        try {
          const quote = await this.fetchQuote(item);
          this.updateStatusBarItem(item, quote);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const label = this.getDisplayLabel(item.symbol);
          item.statusBarItem.text = `$(warning) ${label}`;
          item.statusBarItem.tooltip = `${item.symbol}: ${message}`;
          item.statusBarItem.color = undefined;
          item.statusBarItem.show();
        }
      })
    );
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

    const config = getConfig();
    const stocks = config.get<string[]>('stocks', []);
    const upper = symbol.trim().toUpperCase();
    if (stocks.includes(upper)) {
      vscode.window.showInformationMessage(`${upper} 已在列表中`);
      return;
    }

    await config.update('stocks', [...stocks, upper], vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`已添加美股 ${upper}`);
    this.start();
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

    const config = getConfig();
    const symbols = config.get<string[]>('cryptoSymbols', []);
    const upper = symbol.trim().toUpperCase();
    if (symbols.includes(upper)) {
      vscode.window.showInformationMessage(`${upper} 已在列表中`);
      return;
    }

    await config.update('cryptoSymbols', [...symbols, upper], vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`已添加 ${upper}`);
    this.start();
  }

  private getDisplayLabel(symbol: string): string {
    const aliases = getConfig().get<Record<string, string>>('aliases', {});
    return aliases[symbol] ?? defaultSymbolLabel(symbol);
  }

  private rebuildItemsIfNeeded(): void {
    const config = getConfig();
    const stocks = config.get<string[]>('stocks', ['AAPL', 'NVDA', 'TSLA']);
    const cryptoSymbols = config.get<string[]>('cryptoSymbols', ['BTCUSDT']);
    const expectedKeys = [
      ...stocks.map((s) => `stock:${s.toUpperCase()}`),
      ...cryptoSymbols.map((s) => `crypto:${s.toUpperCase()}`),
    ];

    if (expectedKeys.join('|') !== this.items.map((i) => i.key).join('|')) {
      this.rebuildItems();
    }
  }

  private rebuildItems(): void {
    this.disposeItems();

    const config = getConfig();
    const stocks = config.get<string[]>('stocks', ['AAPL', 'NVDA', 'TSLA']);
    const cryptoSymbols = config.get<string[]>('cryptoSymbols', ['BTCUSDT']);

    let priority = 100;
    for (const symbol of stocks) {
      this.items.push(this.createItem('stock', symbol.toUpperCase(), priority--));
    }
    for (const symbol of cryptoSymbols) {
      this.items.push(this.createItem('crypto', symbol.toUpperCase(), priority--));
    }
  }

  private createItem(type: 'stock' | 'crypto', symbol: string, priority: number): TickerItem {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
    statusBarItem.command = 'kanpan.refresh';
    this.context.subscriptions.push(statusBarItem);

    return { key: `${type}:${symbol}`, type, symbol, statusBarItem };
  }

  private async fetchQuote(item: TickerItem): Promise<QuoteData> {
    if (item.type === 'stock') {
      const apiKey = getConfig().get<string>('finnhubApiKey', '');
      return fetchStockQuote(item.symbol, apiKey);
    }
    return fetchCryptoQuote(item.symbol);
  }

  private updateStatusBarItem(item: TickerItem, quote: QuoteData): void {
    const config = getConfig();
    const monochrome = config.get<boolean>('monochrome', false);
    const showChangePercent = config.get<boolean>('showChangePercent', true);
    const riseColor = config.get<string>('riseColor', '#26a69a');
    const fallColor = config.get<string>('fallColor', '#ef5350');
    const format = config.get<string>('format', '{symbol} {price} {change} {icon}');

    const label = this.getDisplayLabel(quote.symbol);
    const priceText = formatPrice(quote.price);
    const changeText = formatChangePercent(quote.changePercent);

    if (showChangePercent) {
      item.statusBarItem.text = renderFormat(format, label, quote.price, quote.changePercent, !monochrome);
    } else {
      item.statusBarItem.text = `${label} ${priceText}`;
    }

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

  private scheduleRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    const interval = Math.max(getConfig().get<number>('refreshInterval', 10000), 5000);
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), interval);
  }

  private disposeItems(): void {
    for (const item of this.items) {
      item.statusBarItem.dispose();
    }
    this.items = [];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const ticker = new KanpanTicker(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('kanpan.refresh', () => ticker.refresh()),
    vscode.commands.registerCommand('kanpan.show', () => ticker.setVisible(true)),
    vscode.commands.registerCommand('kanpan.hide', () => ticker.setVisible(false)),
    vscode.commands.registerCommand('kanpan.addStock', () => ticker.addStock()),
    vscode.commands.registerCommand('kanpan.addCrypto', () => ticker.addCrypto()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('kanpan')) {
        ticker.start();
      }
    }),
    vscode.window.onDidChangeWindowState(() => {
      void ticker.refresh();
    })
  );

  ticker.start();
}

export function deactivate(): void {}
