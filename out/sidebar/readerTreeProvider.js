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
exports.ReaderTreeProvider = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const treeProviders_1 = require("./treeProviders");
function readerStealthLabel() {
    const raw = vscode.workspace.getConfiguration('kanpan').get('readerStealthSeconds', 10);
    if (!Number.isFinite(raw) || raw <= 0) {
        return '已关闭';
    }
    return `${Math.round(raw)} 秒`;
}
class ReaderTreeProvider {
    constructor(reader) {
        this.reader = reader;
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
        reader.onDidChange(() => this.refresh());
    }
    refresh() {
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        const book = this.reader.currentBook;
        if (!element) {
            const items = [
                new treeProviders_1.KanpanTreeItem('reader-open', '打开 EPUB…', vscode.TreeItemCollapsibleState.None, {
                    iconId: 'folder-opened',
                    tooltip: '',
                    command: { command: 'kanpan.readerOpen', title: '打开 EPUB' },
                }),
                new treeProviders_1.KanpanTreeItem('reader-stealth-seconds', '正文隐藏倒计时', vscode.TreeItemCollapsibleState.None, {
                    iconId: 'eye-closed',
                    description: readerStealthLabel(),
                    tooltip: '',
                    command: { command: 'kanpan.setReaderStealthSeconds', title: '设置隐藏倒计时' },
                }),
            ];
            if (!book) {
                items.push(new treeProviders_1.KanpanTreeItem('reader-hint', '打开后可在下方「正文」阅读', vscode.TreeItemCollapsibleState.None, { iconId: 'info', tooltip: '' }));
                return items;
            }
            const author = book.author ? ` · ${book.author}` : '';
            items.push(new treeProviders_1.KanpanTreeItem('reader-book', book.title, vscode.TreeItemCollapsibleState.Expanded, {
                iconId: 'book',
                description: author.trim() || path.basename(book.filePath),
                tooltip: '',
                contextValue: 'readerBook',
            }), new treeProviders_1.KanpanTreeItem('reader-progress', '阅读进度', vscode.TreeItemCollapsibleState.None, {
                iconId: 'location',
                description: this.reader.progressLabel,
                tooltip: '',
            }), new treeProviders_1.KanpanTreeItem('reader-prev', '上一句', vscode.TreeItemCollapsibleState.None, {
                iconId: 'chevron-left',
                tooltip: '',
                command: { command: 'kanpan.readerPrev', title: '上一句' },
            }), new treeProviders_1.KanpanTreeItem('reader-next', '下一句', vscode.TreeItemCollapsibleState.None, {
                iconId: 'chevron-right',
                tooltip: '',
                command: { command: 'kanpan.readerNext', title: '下一句' },
            }), new treeProviders_1.KanpanTreeItem('reader-close', '关闭当前书', vscode.TreeItemCollapsibleState.None, {
                iconId: 'close',
                tooltip: '',
                command: { command: 'kanpan.readerClose', title: '关闭' },
            }));
            return items;
        }
        if (element.nodeId === 'reader-book' && book) {
            const progress = this.reader.progress;
            return book.chapters.map((ch, index) => {
                const isCurrent = progress?.chapterIndex === index;
                const segCount = ch.segments.length;
                return new treeProviders_1.KanpanTreeItem(`reader-chapter:${index}`, ch.title, vscode.TreeItemCollapsibleState.None, {
                    iconId: isCurrent ? 'bookmark' : 'symbol-text',
                    description: isCurrent
                        ? `▶ ${(progress?.segmentIndex ?? 0) + 1}/${segCount}`
                        : `${segCount} 句`,
                    tooltip: '',
                    contextValue: 'readerChapter',
                    command: {
                        command: 'kanpan.readerJumpChapter',
                        title: '跳转章节',
                        arguments: [{ nodeId: `reader-chapter:${index}` }],
                    },
                });
            });
        }
        return [];
    }
}
exports.ReaderTreeProvider = ReaderTreeProvider;
//# sourceMappingURL=readerTreeProvider.js.map