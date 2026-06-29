import * as vscode from 'vscode';
import { formatChangePercent } from './providers';

export function quoteDecorationUri(key: string, changePercent: number): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'kanpan-quote',
    path: `/${encodeURIComponent(key)}`,
    query: `change=${changePercent}`,
  });
}

export class QuoteDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeEmitter.event;

  refresh(): void {
    this.onDidChangeEmitter.fire(undefined);
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'kanpan-quote') {
      return undefined;
    }

    const match = uri.query.match(/change=(-?\d+(?:\.\d+)?)/);
    if (!match) {
      return undefined;
    }

    const change = parseFloat(match[1]);
    if (!Number.isFinite(change)) {
      return undefined;
    }

    return {
      badge: formatChangePercent(change),
      color: new vscode.ThemeColor(change >= 0 ? 'kanpan.rise' : 'kanpan.fall'),
      tooltip: formatChangePercent(change),
    };
  }
}
