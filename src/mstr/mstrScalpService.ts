import * as vscode from 'vscode';
import { fetchMstrScalpReport, type MstrScalpReport, type ScalpWindow } from '../mstrScalpAdvisor';

export class MstrScalpService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<MstrScalpReport | null>();
  readonly onDidChange = this.emitter.event;

  private report: MstrScalpReport | null = null;
  private window: ScalpWindow = '1h';
  private loading = false;
  private error: string | null = null;
  private timer: NodeJS.Timeout | undefined;
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
    const intervalMs = vscode.workspace.getConfiguration('kanpan').get<number>('mstrScalpRefreshInterval', 90000);
    this.timer = setInterval(() => {
      void this.refresh();
    }, Math.max(intervalMs, 30000));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async setWindow(window: ScalpWindow): Promise<void> {
    if (this.window === window) {
      return;
    }
    this.window = window;
    await this.refresh();
  }

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

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.emitter.dispose();
  }
}
