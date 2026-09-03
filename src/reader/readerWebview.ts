import * as vscode from 'vscode';
import { getReaderStealthSeconds, joinProse, selectReaderStealthSeconds } from './readerStealth';
import { ReaderService } from './readerService';
import { getReaderBrightness, statusBarNeutralColor } from '../colorSettings';

export { selectReaderStealthSeconds };

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export class ReaderWebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'kanpanView.readerText';

  private view: vscode.WebviewView | undefined;
  private htmlReady = false;
  private stealthHidden = false;
  private unlockArrowCount = 0;
  private lastUnlockArrowAt = 0;
  private hideLeftCount = 0;
  private lastHideLeftAt = 0;

  constructor(
    private readonly reader: ReaderService,
    private readonly extensionUri: vscode.Uri
  ) {
    reader.onDidChange(() => {
      if (!reader.currentBook) {
        this.stealthHidden = false;
        this.unlockArrowCount = 0;
        this.hideLeftCount = 0;
      }
      this.pushUpdate();
    });
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

    webview.onDidReceiveMessage(async (msg: { type?: string }) => {
      if (msg?.type === 'ready') {
        this.pushUpdate();
      } else if (msg?.type === 'nextPage') {
        await this.handleNext();
      } else if (msg?.type === 'prevPage') {
        await this.handlePrev();
      } else if (msg?.type === 'open') {
        await vscode.commands.executeCommand('kanpan.readerOpen');
      } else if (msg?.type === 'stealthHidden') {
        this.stealthHidden = true;
        this.unlockArrowCount = 0;
      } else if (msg?.type === 'stealthShown') {
        this.stealthHidden = false;
        this.unlockArrowCount = 0;
      }
    });

    if (!this.htmlReady) {
      const nonce = getNonce();
      const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reader.css'));
      const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reader.js'));
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

  async handleNext(): Promise<void> {
    this.hideLeftCount = 0;
    if (this.consumeArrowUnlock()) {
      return;
    }
    await this.reader.nextPage();
  }

  async handlePrev(): Promise<void> {
    if (this.consumeArrowUnlock()) {
      return;
    }
    if (this.consumeTripleLeftHide()) {
      return;
    }
    await this.reader.prevPage();
  }

  private consumeTripleLeftHide(): boolean {
    if (this.stealthHidden || !this.reader.currentBook) {
      return false;
    }
    const now = Date.now();
    if (now - this.lastHideLeftAt > 1200) {
      this.hideLeftCount = 0;
    }
    this.lastHideLeftAt = now;
    this.hideLeftCount += 1;
    if (this.hideLeftCount >= 3) {
      this.hideLeftCount = 0;
      this.hideToStealth();
      return true;
    }
    return false;
  }

  private consumeArrowUnlock(): boolean {
    if (!this.stealthHidden) {
      return false;
    }
    const now = Date.now();
    if (now - this.lastUnlockArrowAt > 1200) {
      this.unlockArrowCount = 0;
    }
    this.lastUnlockArrowAt = now;
    this.unlockArrowCount += 1;
    if (this.unlockArrowCount >= 2) {
      this.unlockArrowCount = 0;
      this.revealFromStealth();
    }
    return true;
  }

  private hideToStealth(): void {
    this.stealthHidden = true;
    this.unlockArrowCount = 0;
    void this.view?.webview.postMessage({ type: 'setHidden', hidden: true });
  }

  private revealFromStealth(): void {
    this.stealthHidden = false;
    this.hideLeftCount = 0;
    void this.view?.webview.postMessage({ type: 'setHidden', hidden: false });
  }

  refresh(): void {
    this.pushUpdate();
  }

  private pushUpdate(): void {
    if (!this.view || !this.htmlReady) {
      return;
    }

    const book = this.reader.currentBook;
    if (!book) {
      void this.view.webview.postMessage({
        type: 'update',
        mode: 'empty',
        textColor: statusBarNeutralColor(getReaderBrightness()),
      });
      this.view.description = '未打开';
      return;
    }

    const lines = this.reader.getReadingWindow();
    const pageSize = lines.length || this.reader.currentPageSize;
    const prose = joinProse(lines) || '（本章暂无正文）';
    void this.view.webview.postMessage({
      type: 'update',
      mode: 'reading',
      chapter: this.reader.chapterTitle,
      progress: this.reader.progressLabel,
      prose,
      pageSize,
      stealthSeconds: getReaderStealthSeconds(),
      hidden: this.stealthHidden,
      textColor: statusBarNeutralColor(getReaderBrightness()),
    });
    this.view.description = this.reader.progressLabel;
  }
}
