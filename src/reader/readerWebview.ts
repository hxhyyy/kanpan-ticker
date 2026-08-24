import * as vscode from 'vscode';
import { READER_PAGE_SIZE, ReaderService } from './readerService';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Join sentences into continuous prose without forced paragraph breaks. */
function joinProse(parts: string[]): string {
  if (parts.length === 0) {
    return '';
  }
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const prev = out;
    const next = parts[i];
    const prevLast = prev.slice(-1);
    const needsSpace =
      /[A-Za-z0-9]$/.test(prevLast) && /^[A-Za-z0-9]/.test(next);
    out += needsSpace ? ` ${next}` : next;
  }
  return out;
}

export class ReaderWebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'kanpanView.readerText';

  private view: vscode.WebviewView | undefined;

  constructor(private readonly reader: ReaderService) {
    reader.onDidChange(() => this.refresh());
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.description = `约 ${READER_PAGE_SIZE} 句`;

    webviewView.webview.onDidReceiveMessage(async (msg: { type?: string }) => {
      if (msg?.type === 'nextPage') {
        await this.reader.nextPage(READER_PAGE_SIZE);
      } else if (msg?.type === 'prevPage') {
        await this.reader.prevPage(READER_PAGE_SIZE);
      } else if (msg?.type === 'open') {
        await vscode.commands.executeCommand('kanpan.readerOpen');
      }
    });

    this.refresh();
  }

  refresh(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.renderHtml();
    const book = this.reader.currentBook;
    this.view.description = book ? this.reader.progressLabel : '未打开';
  }

  private renderHtml(): string {
    const book = this.reader.currentBook;
    if (!book) {
      return this.shell(`
        <div class="empty">
          <p>打开 EPUB 后，这里显示约 ${READER_PAGE_SIZE} 句正文</p>
          <button data-action="open">打开 EPUB…</button>
        </div>
      `);
    }

    const lines = this.reader.getReadingWindow(READER_PAGE_SIZE);
    const prose = joinProse(lines);
    const bodyHtml = prose
      ? `<div class="prose">${escapeHtml(prose)}</div>`
      : `<div class="prose muted">（本章暂无正文）</div>`;

    return this.shell(`
      <div class="meta">
        <div class="chapter">${escapeHtml(this.reader.chapterTitle)}</div>
        <div class="progress">${escapeHtml(this.reader.progressLabel)}</div>
      </div>
      <div class="body" title="点击下翻 ${READER_PAGE_SIZE} 句 · 右键上翻 · ← → 同翻页" data-action="nextPage">
        ${bodyHtml}
      </div>
      <div class="bar">
        <button data-action="prevPage" title="上翻 ${READER_PAGE_SIZE} 句">← ${READER_PAGE_SIZE}</button>
        <button data-action="nextPage" title="下翻 ${READER_PAGE_SIZE} 句">${READER_PAGE_SIZE} →</button>
      </div>
    `);
  }

  private shell(body: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: light dark;
    }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .wrap {
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
      padding: 8px 10px 8px;
      gap: 6px;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      opacity: 0.7;
    }
    .chapter {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .progress {
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .body {
      flex: 1;
      min-height: 7.5em;
      cursor: pointer;
      overflow: hidden;
      border-radius: 4px;
      padding: 2px 0;
    }
    .body:hover .prose {
      opacity: 0.92;
    }
    .prose {
      margin: 0;
      line-height: 1.55;
      word-break: break-word;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 5;
      overflow: hidden;
    }
    .prose.muted {
      opacity: 0.65;
    }
    .bar {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    button {
      flex: 1;
      border: 1px solid var(--vscode-button-border, var(--vscode-input-border));
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      padding: 3px 0;
      cursor: pointer;
      border-radius: 2px;
    }
    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      opacity: 0.85;
      font-size: 12px;
    }
    .empty button {
      border: 1px solid var(--vscode-button-border, var(--vscode-input-border));
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      padding: 4px 10px;
      cursor: pointer;
      border-radius: 2px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    ${body}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const type = el.getAttribute('data-action');
      if (type) vscode.postMessage({ type });
    });
    document.addEventListener('contextmenu', (e) => {
      const body = e.target.closest('.body');
      if (!body) return;
      e.preventDefault();
      vscode.postMessage({ type: 'prevPage' });
    });
  </script>
</body>
</html>`;
  }
}
