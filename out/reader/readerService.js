"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReaderService = exports.READER_PAGE_CHARS = exports.READER_PAGE_SIZE = void 0;
const vscode = __importStar(require("vscode"));
const epub_1 = require("./epub");
exports.READER_PAGE_SIZE = 5;
/** Approx chars that fit in the sidebar body without being cut off. */
exports.READER_PAGE_CHARS = 140;
const PROGRESS_KEY = 'kanpan.reader.progress';
const BOOK_PATH_KEY = 'kanpan.reader.bookPath';
class ReaderService {
    constructor(context) {
        this.context = context;
        this.chapterIndex = 0;
        this.segmentIndex = 0;
        /** How many sentences the last rendered page actually contained. */
        this.lastWindowCount = exports.READER_PAGE_SIZE;
        this.onDidChangeEmitter = new vscode.EventEmitter();
        this.onDidChange = this.onDidChangeEmitter.event;
    }
    get currentBook() {
        return this.book;
    }
    get progress() {
        if (!this.book) {
            return undefined;
        }
        return {
            filePath: this.book.filePath,
            chapterIndex: this.chapterIndex,
            segmentIndex: this.segmentIndex,
        };
    }
    get chapterTitle() {
        return this.book?.chapters[this.chapterIndex]?.title ?? '';
    }
    get currentSegment() {
        return this.book?.chapters[this.chapterIndex]?.segments[this.segmentIndex] ?? '';
    }
    /** Sentences shown on the current page (used for continuous paging). */
    get currentPageSize() {
        return Math.max(1, this.lastWindowCount);
    }
    /**
     * Pack complete sentences into one page.
     * Never mid-cut a sentence; stop before exceeding char budget (except the first).
     */
    getReadingWindow(maxChars = exports.READER_PAGE_CHARS, maxSentences = exports.READER_PAGE_SIZE) {
        if (!this.book || maxSentences <= 0) {
            this.lastWindowCount = 0;
            return [];
        }
        const result = [];
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
    get progressLabel() {
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
    dispose() {
        void vscode.commands.executeCommand('setContext', 'kanpan.readerActive', false);
        this.onDidChangeEmitter.dispose();
    }
    async restore() {
        const savedPath = this.context.globalState.get(BOOK_PATH_KEY);
        if (!savedPath) {
            return;
        }
        try {
            await this.openBook(savedPath, { silent: true });
        }
        catch {
            // Book may have been moved; ignore on startup
        }
    }
    async openBook(filePath, options) {
        const book = await (0, epub_1.parseEpub)(filePath);
        this.book = book;
        await this.context.globalState.update(BOOK_PATH_KEY, filePath);
        const saved = this.context.globalState.get(PROGRESS_KEY);
        if (options?.chapterIndex !== undefined &&
            options?.segmentIndex !== undefined) {
            this.chapterIndex = clamp(options.chapterIndex, 0, book.chapters.length - 1);
            const segs = book.chapters[this.chapterIndex].segments.length;
            this.segmentIndex = clamp(options.segmentIndex, 0, Math.max(0, segs - 1));
        }
        else if (saved && saved.filePath === filePath) {
            this.chapterIndex = clamp(saved.chapterIndex, 0, book.chapters.length - 1);
            const segs = book.chapters[this.chapterIndex].segments.length;
            this.segmentIndex = clamp(saved.segmentIndex, 0, Math.max(0, segs - 1));
        }
        else {
            this.chapterIndex = 0;
            this.segmentIndex = 0;
        }
        this.notifyChange();
        await this.saveProgress();
        if (!options?.silent) {
            const author = book.author ? ` · ${book.author}` : '';
            vscode.window.showInformationMessage(`已打开《${book.title}》${author}（${book.chapters.length} 章）· 在左侧「正文」阅读`);
        }
    }
    async pickAndOpen() {
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
    async jumpToChapter(chapterIndex) {
        if (!this.book) {
            return;
        }
        this.chapterIndex = clamp(chapterIndex, 0, this.book.chapters.length - 1);
        this.segmentIndex = 0;
        this.notifyChange();
        await this.saveProgress();
    }
    async next() {
        await this.advance(1);
    }
    async prev() {
        await this.advance(-1);
    }
    async nextPage(count) {
        const n = count ?? this.currentPageSize;
        await this.advance(Math.max(1, n));
    }
    async prevPage(count) {
        const n = count ?? this.currentPageSize;
        await this.advance(-Math.max(1, n));
    }
    async closeBook() {
        this.book = undefined;
        this.chapterIndex = 0;
        this.segmentIndex = 0;
        void vscode.commands.executeCommand('setContext', 'kanpan.readerActive', false);
        await this.context.globalState.update(BOOK_PATH_KEY, undefined);
        await this.context.globalState.update(PROGRESS_KEY, undefined);
        this.onDidChangeEmitter.fire();
    }
    notifyChange() {
        void vscode.commands.executeCommand('setContext', 'kanpan.readerActive', Boolean(this.book));
        this.onDidChangeEmitter.fire();
    }
    async advance(delta) {
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
    totalSegments() {
        if (!this.book) {
            return 0;
        }
        return this.book.chapters.reduce((n, c) => n + c.segments.length, 0);
    }
    flattenIndex() {
        if (!this.book) {
            return -1;
        }
        let idx = 0;
        for (let i = 0; i < this.chapterIndex; i++) {
            idx += this.book.chapters[i].segments.length;
        }
        return idx + this.segmentIndex;
    }
    setFlatIndex(flat) {
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
    async saveProgress() {
        if (!this.book) {
            return;
        }
        await this.context.globalState.update(PROGRESS_KEY, {
            filePath: this.book.filePath,
            chapterIndex: this.chapterIndex,
            segmentIndex: this.segmentIndex,
        });
    }
}
exports.ReaderService = ReaderService;
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
//# sourceMappingURL=readerService.js.map