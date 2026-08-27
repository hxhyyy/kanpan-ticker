import * as vscode from 'vscode';
import { GridSimService } from './gridSimService';
import type { BinanceGridParams } from '../gridBacktest';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export class GridSimWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'kanpanView.gridSim';

  private view: vscode.WebviewView | undefined;
  private htmlReady = false;

  constructor(
    private readonly service: GridSimService,
    private readonly extensionUri: vscode.Uri
  ) {
    service.onDidChange(() => this.pushUpdate());
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webview.onDidReceiveMessage(
      async (msg: {
        type?: string;
        params?: Partial<BinanceGridParams>;
      }) => {
        if (msg?.type === 'ready') {
          this.pushUpdate();
          if (!this.service.currentResult) {
            void this.service.run();
          }
        } else if (msg?.type === 'run') {
          if (msg.params) {
            await this.service.setParams(msg.params);
          }
          await this.service.run();
        } else if (msg?.type === 'autoRange') {
          try {
            await this.service.autoRange();
            this.pushUpdate();
            await this.service.run();
          } catch {
            await this.service.run();
          }
        } else if (msg?.type === 'optimize') {
          if (msg.params) {
            await this.service.setParams(msg.params);
          }
          await this.service.optimize();
        } else if (msg?.type === 'setParams' && msg.params) {
          await this.service.setParams(msg.params);
          this.pushUpdate();
        }
      }
    );

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.pushUpdate();
      }
    });

    if (!this.htmlReady) {
      const nonce = getNonce();
      const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'gridSim.css'));
      const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'gridSim.js'));
      webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <link rel="stylesheet" href="${cssUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
      this.htmlReady = true;
    }
  }

  private pushUpdate(): void {
    if (!this.view?.webview) {
      return;
    }
    this.view.webview.postMessage({
      type: 'update',
      loading: this.service.isLoading,
      error: this.service.lastError,
      params: this.service.currentParams,
      result: this.service.currentResult,
    });
  }

  /** 右上角运行：先让页面读取当前表单再回测，避免覆盖用户刚填的参数 */
  async requestRunFromForm(): Promise<void> {
    if (!this.view?.webview) {
      await this.service.run();
      return;
    }
    this.view.webview.postMessage({ type: 'pleaseRun' });
  }

  dispose(): void {
    // service disposed by extension
  }
}
