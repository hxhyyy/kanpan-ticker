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

function getReaderStealthSeconds(): number {
  const raw = vscode.workspace.getConfiguration('kanpan').get<number>('readerStealthSeconds', 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.min(600, Math.max(1, Math.round(raw)));
}

export async function selectReaderStealthSeconds(): Promise<void> {
  const config = vscode.workspace.getConfiguration('kanpan');
  const current = config.get<number>('readerStealthSeconds', 10);
  const value = await vscode.window.showInputBox({
    title: '正文无操作自动隐藏',
    prompt: '多少秒无点击后隐藏正文（0 表示关闭）',
    value: String(current),
    validateInput: (input) => {
      const n = Number(input);
      if (!Number.isFinite(n) || n < 0 || n > 600) {
        return '请输入 0–600 之间的数字';
      }
      return undefined;
    },
  });
  if (value === undefined) {
    return;
  }
  await config.update('readerStealthSeconds', Number(value), vscode.ConfigurationTarget.Global);
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

    return this.shell(
      `
      <div class="wrap stealth-zone">
        <div class="content-panel">
          <div class="meta">
            <div class="chapter">${escapeHtml(this.reader.chapterTitle)}</div>
            <div class="progress">${escapeHtml(this.reader.progressLabel)}</div>
          </div>
          <div class="body" title="点击下翻 · 右键上翻 · 无操作自动隐藏" data-action="nextPage">
            ${bodyHtml}
          </div>
          <div class="bar">
            <button data-action="prevPage" title="上翻 ${READER_PAGE_SIZE} 句">← ${READER_PAGE_SIZE}</button>
            <button data-action="nextPage" title="下翻 ${READER_PAGE_SIZE} 句">${READER_PAGE_SIZE} →</button>
          </div>
        </div>
        <div class="stealth-overlay" hidden aria-hidden="true"></div>
      </div>
    `,
      getReaderStealthSeconds()
    );
  }

  private shell(body: string, stealthSeconds = getReaderStealthSeconds()): string {
    const idleMs = stealthSeconds > 0 ? stealthSeconds * 1000 : 0;
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
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
      padding: 8px 10px 8px;
      gap: 6px;
    }
    .content-panel {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      min-height: 0;
    }
    .wrap.stealth-hidden .content-panel {
      visibility: hidden;
    }
    .stealth-overlay {
      position: absolute;
      inset: 8px 10px;
      cursor: default;
      border-radius: 4px;
      background: var(--vscode-sideBar-background);
    }
    .stealth-overlay[hidden] {
      display: none !important;
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
    const IDLE_MS = ${idleMs};
    const STEALTH_ENABLED = IDLE_MS > 0;
    const UNLOCK_CLICKS = 3;
    const UNLOCK_WINDOW_MS = 1200;

    const saved = vscode.getState() || {};
    let hidden = STEALTH_ENABLED && !!saved.hidden;
    let unlockClicks = 0;
    let lastUnlockAt = 0;
    let idleTimer = null;

    const wrap = document.querySelector('.stealth-zone');
    const overlay = document.querySelector('.stealth-overlay');

    function applyStealth() {
      if (!wrap || !overlay) return;
      wrap.classList.toggle('stealth-hidden', hidden);
      overlay.hidden = !hidden;
      if (hidden) {
        unlockClicks = 0;
      }
      vscode.setState({ hidden });
    }

    function resetIdleTimer() {
      if (!STEALTH_ENABLED || hidden) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        hidden = true;
        applyStealth();
      }, IDLE_MS);
    }

    function tryUnlock() {
      if (!STEALTH_ENABLED) return true;
      const now = Date.now();
      if (now - lastUnlockAt > UNLOCK_WINDOW_MS) {
        unlockClicks = 0;
      }
      lastUnlockAt = now;
      unlockClicks += 1;
      if (unlockClicks >= UNLOCK_CLICKS) {
        hidden = false;
        unlockClicks = 0;
        applyStealth();
        resetIdleTimer();
        return true;
      }
      return false;
    }

    applyStealth();
    if (!hidden) resetIdleTimer();

    document.addEventListener('click', (e) => {
      const zone = e.target.closest('.stealth-zone');
      if (!zone) return;

      if (hidden) {
        e.preventDefault();
        e.stopPropagation();
        tryUnlock();
        return;
      }

      if (STEALTH_ENABLED) resetIdleTimer();
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const type = el.getAttribute('data-action');
      if (type) vscode.postMessage({ type });
    });

    document.addEventListener('contextmenu', (e) => {
      const zone = e.target.closest('.stealth-zone');
      if (!zone) return;
      e.preventDefault();
      if (hidden) {
        tryUnlock();
        return;
      }
      if (STEALTH_ENABLED) resetIdleTimer();
      const body = e.target.closest('.body');
      if (body) vscode.postMessage({ type: 'prevPage' });
    });
  </script>
</body>
</html>`;
  }
}
