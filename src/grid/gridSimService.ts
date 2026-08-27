import * as vscode from 'vscode';
import {
  defaultGridParams,
  runBinanceGridSim,
  suggestGridRange,
  type BinanceGridParams,
  type GridSimResult,
} from '../gridBacktest';

const STORAGE_KEY = 'kanpan.gridParams';

export class GridSimService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<GridSimResult | null>();
  readonly onDidChange = this.emitter.event;

  private params: BinanceGridParams;
  private result: GridSimResult | null = null;
  private loading = false;
  private error: string | null = null;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    const saved = context.globalState.get<BinanceGridParams>(STORAGE_KEY);
    this.params = saved ? { ...defaultGridParams(), ...saved } : defaultGridParams();
  }

  get currentParams(): BinanceGridParams {
    return { ...this.params };
  }

  get currentResult(): GridSimResult | null {
    return this.result;
  }

  get isLoading(): boolean {
    return this.loading;
  }

  get lastError(): string | null {
    return this.error;
  }

  async setParams(partial: Partial<BinanceGridParams>): Promise<void> {
    this.params = { ...this.params, ...partial };
    await this.context.globalState.update(STORAGE_KEY, this.params);
  }

  async autoRange(): Promise<void> {
    const range = await suggestGridRange(Math.min(this.params.days, 3));
    await this.setParams({
      lower: range.lower,
      upper: range.upper,
    });
  }

  async run(): Promise<void> {
    if (this.loading || this.disposed) {
      return;
    }
    this.loading = true;
    this.emitter.fire(this.result);
    try {
      this.result = await runBinanceGridSim(this.params);
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
      this.emitter.fire(this.result);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.emitter.dispose();
  }
}
