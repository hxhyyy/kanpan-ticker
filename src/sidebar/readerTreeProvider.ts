import * as path from 'path';
import * as vscode from 'vscode';
import { ReaderService } from '../reader/readerService';
import { KanpanTreeItem } from './treeProviders';

function readerStealthLabel(): string {
  const raw = vscode.workspace.getConfiguration('kanpan').get<number>('readerStealthSeconds', 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return '已关闭';
  }
  return `${Math.round(raw)} 秒`;
}

export class ReaderTreeProvider implements vscode.TreeDataProvider<KanpanTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<KanpanTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly reader: ReaderService) {
    reader.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: KanpanTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: KanpanTreeItem): KanpanTreeItem[] {
    const book = this.reader.currentBook;

    if (!element) {
      const items: KanpanTreeItem[] = [
        new KanpanTreeItem('reader-open', '打开 EPUB…', vscode.TreeItemCollapsibleState.None, {
          iconId: 'folder-opened',
          command: { command: 'kanpan.readerOpen', title: '打开 EPUB' },
        }),
        new KanpanTreeItem(
          'reader-stealth-seconds',
          '正文隐藏倒计时',
          vscode.TreeItemCollapsibleState.None,
          {
            iconId: 'eye-closed',
            description: readerStealthLabel(),
            tooltip: '无操作多少秒后自动隐藏正文\n0 表示关闭',
            command: { command: 'kanpan.setReaderStealthSeconds', title: '设置隐藏倒计时' },
          }
        ),
      ];

      if (!book) {
        items.push(
          new KanpanTreeItem(
            'reader-hint',
            '打开后可在下方「正文」阅读',
            vscode.TreeItemCollapsibleState.None,
            { iconId: 'info' }
          )
        );
        return items;
      }

      const author = book.author ? ` · ${book.author}` : '';
      items.push(
        new KanpanTreeItem(
          'reader-book',
          book.title,
          vscode.TreeItemCollapsibleState.Expanded,
          {
            iconId: 'book',
            description: author.trim() || path.basename(book.filePath),
            tooltip: `${book.filePath}\n${book.chapters.length} 章 · ${this.reader.progressLabel}`,
            contextValue: 'readerBook',
          }
        ),
        new KanpanTreeItem(
          'reader-progress',
          '阅读进度',
          vscode.TreeItemCollapsibleState.None,
          {
            iconId: 'location',
            description: this.reader.progressLabel,
            tooltip: this.reader.currentSegment || '暂无正文',
          }
        ),
        new KanpanTreeItem('reader-prev', '上一句', vscode.TreeItemCollapsibleState.None, {
          iconId: 'chevron-left',
          command: { command: 'kanpan.readerPrev', title: '上一句' },
        }),
        new KanpanTreeItem('reader-next', '下一句', vscode.TreeItemCollapsibleState.None, {
          iconId: 'chevron-right',
          command: { command: 'kanpan.readerNext', title: '下一句' },
        }),
        new KanpanTreeItem('reader-close', '关闭当前书', vscode.TreeItemCollapsibleState.None, {
          iconId: 'close',
          command: { command: 'kanpan.readerClose', title: '关闭' },
        })
      );
      return items;
    }

    if (element.nodeId === 'reader-book' && book) {
      const progress = this.reader.progress;
      return book.chapters.map((ch, index) => {
        const isCurrent = progress?.chapterIndex === index;
        const segCount = ch.segments.length;
        return new KanpanTreeItem(
          `reader-chapter:${index}`,
          ch.title,
          vscode.TreeItemCollapsibleState.None,
          {
            iconId: isCurrent ? 'bookmark' : 'symbol-text',
            description: isCurrent
              ? `▶ ${(progress?.segmentIndex ?? 0) + 1}/${segCount}`
              : `${segCount} 句`,
            tooltip: ch.title,
            contextValue: 'readerChapter',
            command: {
              command: 'kanpan.readerJumpChapter',
              title: '跳转章节',
              arguments: [{ nodeId: `reader-chapter:${index}` }],
            },
          }
        );
      });
    }

    return [];
  }
}
