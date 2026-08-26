import * as vscode from 'vscode';
import { MstrScalpService } from './mstrScalpService';
import type { ScalpWindow } from '../mstrScalpAdvisor';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export class MstrScalpWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'kanpanView.mstrScalp';

  private view: vscode.WebviewView | undefined;
  private htmlReady = false;

  constructor(
    private readonly service: MstrScalpService,
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

    webview.onDidReceiveMessage(async (msg: { type?: string; window?: ScalpWindow }) => {
      if (msg?.type === 'ready') {
        this.service.start();
        this.pushUpdate();
      } else if (msg?.type === 'refresh') {
        await this.service.refresh();
      } else if (msg?.type === 'setWindow' && msg.window) {
        await this.service.setWindow(msg.window);
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.service.refresh();
      }
    });

    if (!this.htmlReady) {
      const nonce = getNonce();
      const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'mstrScalp.css'));
      const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'mstrScalp.js'));
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
    const report = this.service.currentReport;
    this.view.webview.postMessage({
      type: 'update',
      loading: this.service.isLoading,
      error: this.service.lastError,
      window: this.service.currentWindow,
      report,
    });
  }

  dispose(): void {
    this.service.stop();
  }
}
