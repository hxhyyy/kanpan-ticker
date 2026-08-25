import * as vscode from 'vscode';
import { EpubBook, parseEpub } from './epub';

export const READER_PAGE_SIZE = 5;
/** Approx chars that fit in the sidebar body without being cut off. */
export const READER_PAGE_CHARS = 140;

const PROGRESS_KEY = 'kanpan.reader.progress';
const BOOK_PATH_KEY = 'kanpan.reader.bookPath';

export interface ReaderProgress {
  filePath: string;
  chapterIndex: number;
  segmentIndex: number;
}

export class ReaderService {
  private book: EpubBook | undefined;
  private chapterIndex = 0;
  private segmentIndex = 0;
  /** How many sentences the last rendered page actually contained. */
  private lastWindowCount = READER_PAGE_SIZE;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get currentBook(): EpubBook | undefined {
    return this.book;
  }

  get progress(): ReaderProgress | undefined {
    if (!this.book) {
      return undefined;
    }
    return {
      filePath: this.book.filePath,
      chapterIndex: this.chapterIndex,
      segmentIndex: this.segmentIndex,
    };
  }

  get chapterTitle(): string {
    return this.book?.chapters[this.chapterIndex]?.title ?? '';
  }

  get currentSegment(): string {
    return this.book?.chapters[this.chapterIndex]?.segments[this.segmentIndex] ?? '';
  }

  /** Sentences shown on the current page (used for continuous paging). */
  get currentPageSize(): number {
    return Math.max(1, this.lastWindowCount);
  }

  /**
   * Pack complete sentences into one page.
   * Never mid-cut a sentence; stop before exceeding char budget (except the first).
   */
  getReadingWindow(
    maxChars = READER_PAGE_CHARS,
    maxSentences = READER_PAGE_SIZE
  ): string[] {
    if (!this.book || maxSentences <= 0) {
      this.lastWindowCount = 0;
      return [];
    }
    const result: string[] = [];
    let ci = this.chapterIndex;
    let si = this.segmentIndex;
    let chars = 0;

    while (result.length < maxSentences && ci < this.book.chapters.length) {
      const ch = this.book.chapters[ci];
      while (si < ch.segments.length && result.length < maxSentences) {
        const next = ch.segments[si];
        if (result.length > 0 && chars + next.length > maxChars) {
          this.lastWindowCount = result.length;
          return result;
        }
        result.push(next);
        chars += next.length;
        si += 1;
      }
      ci += 1;
      si = 0;
    }

    this.lastWindowCount = result.length;
    return result;
  }

  get progressLabel(): string {
    if (!this.book) {
      return '';
    }
    const ch = this.book.chapters[this.chapterIndex];
    if (!ch) {
      return '';
    }
    const totalSeg = this.book.chapters.reduce((n, c) => n + c.segments.length, 0);
    let done = 0;
    for (let i = 0; i < this.chapterIndex; i++) {
      done += this.book.chapters[i].segments.length;
    }
    done += this.segmentIndex + 1;
    const pct = totalSeg > 0 ? Math.round((done / totalSeg) * 100) : 0;
    return `${this.chapterIndex + 1}/${this.book.chapters.length} · ${this.segmentIndex + 1}/${ch.segments.length} · ${pct}%`;
  }

  dispose(): void {
    void vscode.commands.executeCommand('setContext', 'kanpan.readerActive', false);
    this.onDidChangeEmitter.dispose();
  }

  async restore(): Promise<void> {
    const savedPath = this.context.globalState.get<string>(BOOK_PATH_KEY);
    if (!savedPath) {
      return;
    }
    try {
      await this.openBook(savedPath, { silent: true });
    } catch {
      // Book may have been moved; ignore on startup
    }
  }

  async openBook(
    filePath: string,
    options?: { silent?: boolean; chapterIndex?: number; segmentIndex?: number }
  ): Promise<void> {
    const book = await parseEpub(filePath);
    this.book = book;
    await this.context.globalState.update(BOOK_PATH_KEY, filePath);

    const saved = this.context.globalState.get<ReaderProgress>(PROGRESS_KEY);
    if (
      options?.chapterIndex !== undefined &&
      options?.segmentIndex !== undefined
    ) {
      this.chapterIndex = clamp(options.chapterIndex, 0, book.chapters.length - 1);
      const segs = book.chapters[this.chapterIndex].segments.length;
      this.segmentIndex = clamp(options.segmentIndex, 0, Math.max(0, segs - 1));
    } else if (saved && saved.filePath === filePath) {
      this.chapterIndex = clamp(saved.chapterIndex, 0, book.chapters.length - 1);
      const segs = book.chapters[this.chapterIndex].segments.length;
      this.segmentIndex = clamp(saved.segmentIndex, 0, Math.max(0, segs - 1));
    } else {
      this.chapterIndex = 0;
      this.segmentIndex = 0;
    }

    this.notifyChange();
    await this.saveProgress();

    if (!options?.silent) {
      const author = book.author ? ` · ${book.author}` : '';
      vscode.window.showInformationMessage(
        `已打开《${book.title}》${author}（${book.chapters.length} 章）· 在左侧「正文」阅读`
      );
    }
  }

  async pickAndOpen(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { EPUB: ['epub'] },
      openLabel: '打开 EPUB',
      title: '选择要阅读的 EPUB',
    });
    if (!uris?.[0]) {
      return;
    }
    await this.openBook(uris[0].fsPath);
  }

  async jumpToChapter(chapterIndex: number): Promise<void> {
    if (!this.book) {
      return;
    }
    this.chapterIndex = clamp(chapterIndex, 0, this.book.chapters.length - 1);
    this.segmentIndex = 0;
    this.notifyChange();
    await this.saveProgress();
  }

  async next(): Promise<void> {
    await this.advance(1);
  }

  async prev(): Promise<void> {
    await this.advance(-1);
  }

  async nextPage(count?: number): Promise<void> {
    const n = count ?? this.currentPageSize;
    await this.advance(Math.max(1, n));
  }

  async prevPage(count?: number): Promise<void> {
    const n = count ?? this.currentPageSize;
    await this.advance(-Math.max(1, n));
  }

  async closeBook(): Promise<void> {
    this.book = undefined;
    this.chapterIndex = 0;
    this.segmentIndex = 0;
    void vscode.commands.executeCommand('setContext', 'kanpan.readerActive', false);
    await this.context.globalState.update(BOOK_PATH_KEY, undefined);
    await this.context.globalState.update(PROGRESS_KEY, undefined);
    this.onDidChangeEmitter.fire();
  }

  private notifyChange(): void {
    void vscode.commands.executeCommand('setContext', 'kanpan.readerActive', Boolean(this.book));
    this.onDidChangeEmitter.fire();
  }

  private async advance(delta: number): Promise<void> {
    if (!this.book || delta === 0) {
      return;
    }

    const flat = this.flattenIndex();
    if (flat < 0) {
      return;
    }

    const total = this.totalSegments();
    const target = flat + delta;
    if (target < 0) {
      this.chapterIndex = 0;
      this.segmentIndex = 0;
      vscode.window.setStatusBarMessage('已在全书开头', 2000);
      this.notifyChange();
      await this.saveProgress();
      return;
    }
    if (target >= total) {
      this.setFlatIndex(total - 1);
      vscode.window.setStatusBarMessage('已读到全书末尾', 2000);
      this.notifyChange();
      await this.saveProgress();
      return;
    }

    this.setFlatIndex(target);
    this.notifyChange();
    await this.saveProgress();
  }

  private totalSegments(): number {
    if (!this.book) {
      return 0;
    }
    return this.book.chapters.reduce((n, c) => n + c.segments.length, 0);
  }

  private flattenIndex(): number {
    if (!this.book) {
      return -1;
    }
    let idx = 0;
    for (let i = 0; i < this.chapterIndex; i++) {
      idx += this.book.chapters[i].segments.length;
    }
    return idx + this.segmentIndex;
  }

  private setFlatIndex(flat: number): void {
    if (!this.book) {
      return;
    }
    let remain = flat;
    for (let i = 0; i < this.book.chapters.length; i++) {
      const len = this.book.chapters[i].segments.length;
      if (remain < len) {
        this.chapterIndex = i;
        this.segmentIndex = remain;
        return;
      }
      remain -= len;
    }
    const last = this.book.chapters.length - 1;
    this.chapterIndex = last;
    this.segmentIndex = Math.max(0, this.book.chapters[last].segments.length - 1);
  }

  private async saveProgress(): Promise<void> {
    if (!this.book) {
      return;
    }
    await this.context.globalState.update(PROGRESS_KEY, {
      filePath: this.book.filePath,
      chapterIndex: this.chapterIndex,
      segmentIndex: this.segmentIndex,
    } satisfies ReaderProgress);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
