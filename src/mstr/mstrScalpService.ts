import * as vscode from 'vscode';
import { fetchBtcLivePrice, fetchMstrLivePrice } from '../chartData';
import { fetchMstrScalpReport, type MstrScalpReport, type ScalpWindow } from '../mstrScalpAdvisor';

export class MstrScalpService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<MstrScalpReport | null>();
  readonly onDidChange = this.emitter.event;

  private report: MstrScalpReport | null = null;
  private window: ScalpWindow = '1h';
  private loading = false;
  private priceLoading = false;
  private error: string | null = null;
  private analysisTimer: NodeJS.Timeout | undefined;
  private priceTimer: NodeJS.Timeout | undefined;
  private disposed = false;

  get currentReport(): MstrScalpReport | null {
    return this.report;
  }

  get currentWindow(): ScalpWindow {
    return this.window;
  }

  get isLoading(): boolean {
    return this.loading;
  }

  get lastError(): string | null {
    return this.error;
  }

  start(): void {
    this.stop();
    void this.refresh();
    void this.refreshPrices();

    const cfg = vscode.workspace.getConfiguration('kanpan');
    const analysisMs = Math.max(cfg.get<number>('mstrScalpRefreshInterval', 60000), 30000);
    const priceMs = Math.max(cfg.get<number>('mstrScalpPriceInterval', 2000), 1000);

    this.analysisTimer = setInterval(() => {
      void this.refresh();
    }, analysisMs);

    this.priceTimer = setInterval(() => {
      void this.refreshPrices();
    }, priceMs);
  }

  stop(): void {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = undefined;
    }
    if (this.priceTimer) {
      clearInterval(this.priceTimer);
      this.priceTimer = undefined;
    }
  }

  async setWindow(window: ScalpWindow): Promise<void> {
    if (this.window === window) {
      return;
    }
    this.window = window;
    await this.refresh();
  }

  /** 完整分析（区间 / tgt / 建议），默认约 1 分钟 */
  async refresh(): Promise<void> {
    if (this.loading || this.disposed) {
      return;
    }
    this.loading = true;
    this.emitter.fire(this.report);
    try {
      this.report = await fetchMstrScalpReport(this.window);
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
      this.emitter.fire(this.report);
    }
  }

  /** 仅刷新市价，默认约 2 秒 */
  async refreshPrices(): Promise<void> {
    if (this.priceLoading || this.disposed || !this.report) {
      return;
    }
    this.priceLoading = true;
    try {
      const [mstrPrice, btcPrice] = await Promise.all([fetchMstrLivePrice(), fetchBtcLivePrice()]);
      if (!this.report || this.disposed) {
        return;
      }
      const width = this.report.range.width;
      const support = this.report.range.support;
      const positionPct =
        width > 0 ? Math.max(0, Math.min(100, ((mstrPrice - support) / width) * 100)) : this.report.range.positionPct;

      this.report = {
        ...this.report,
        mstrPrice: Math.round(mstrPrice * 100) / 100,
        range: {
          ...this.report.range,
          positionPct,
        },
        btc: {
          ...this.report.btc,
          price: btcPrice,
        },
        refreshedAt: Date.now(),
      };
      this.emitter.fire(this.report);
    } catch {
      // 市价刷新失败不打断分析面板，等下次再试
    } finally {
      this.priceLoading = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.emitter.dispose();
  }
}
