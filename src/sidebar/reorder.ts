import * as vscode from 'vscode';
import { normalizeAShareCode } from '../aShareSources';
import { getConfig, MarketType, marketKeyOf, parseMarketKey } from '../marketService';
import { KanpanTreeItem } from './treeProviders';

const STOCK_TREE_MIME = 'application/vnd.code.tree.kanpanview.stock';
const CRYPTO_TREE_MIME = 'application/vnd.code.tree.kanpanview.crypto';

function isQuoteNodeId(nodeId: string): boolean {
  return /^(stock|ashare|crypto):/.test(nodeId);
}

function createDragController(
  mimeType: string,
  allowedTypes: MarketType[],
  reorder: (sourceNodeId: string, targetNodeId: string) => Promise<boolean>,
  refresh: () => void
): vscode.TreeDragAndDropController<KanpanTreeItem> {
  return {
    dragMimeTypes: [mimeType],
    dropMimeTypes: [mimeType],
    handleDrag(source, dataTransfer) {
      const item = source[0];
      if (!item || !isQuoteNodeId(item.nodeId)) {
        return;
      }
      const parsed = parseMarketKey(item.nodeId);
      if (!allowedTypes.includes(parsed.type)) {
        return;
      }
      dataTransfer.set(mimeType, new vscode.DataTransferItem(item.nodeId));
    },
    async handleDrop(target, dataTransfer) {
      const sourceNodeId = dataTransfer.get(mimeType)?.value;
      if (typeof sourceNodeId !== 'string' || !target || !isQuoteNodeId(target.nodeId)) {
        return;
      }
      const moved = await reorder(sourceNodeId, target.nodeId);
      if (moved) {
        refresh();
      }
    },
  };
}

export function createStockDragController(
  reorder: (sourceNodeId: string, targetNodeId: string) => Promise<boolean>,
  refresh: () => void
): vscode.TreeDragAndDropController<KanpanTreeItem> {
  return createDragController(STOCK_TREE_MIME, ['stock', 'ashare'], reorder, refresh);
}

export function createCryptoDragController(
  reorder: (sourceNodeId: string, targetNodeId: string) => Promise<boolean>,
  refresh: () => void
): vscode.TreeDragAndDropController<KanpanTreeItem> {
  return createDragController(CRYPTO_TREE_MIME, ['crypto'], reorder, refresh);
}

export function getConfigKeyForType(type: MarketType): 'stocks' | 'aShares' | 'cryptoSymbols' {
  if (type === 'stock') {
    return 'stocks';
  }
  if (type === 'ashare') {
    return 'aShares';
  }
  return 'cryptoSymbols';
}

export function normalizeWatchSymbol(type: MarketType, symbol: string): string {
  if (type === 'ashare') {
    return normalizeAShareCode(symbol);
  }
  return symbol.toUpperCase();
}

export function readWatchList(type: MarketType): string[] {
  const config = getConfig();
  const key = getConfigKeyForType(type);
  const defaults =
    type === 'stock' ? ['AAPL', 'NVDA', 'TSLA'] : type === 'ashare' ? ['sh600519', 'sz300750'] : ['BTCUSDT'];
  return config.get<string[]>(key, defaults).map((symbol) => normalizeWatchSymbol(type, symbol));
}

export function indexInWatchList(type: MarketType, symbol: string, list: string[]): number {
  const normalized = normalizeWatchSymbol(type, symbol);
  if (type === 'ashare') {
    return list.findIndex((item) => normalizeAShareCode(item) === normalized);
  }
  return list.findIndex((item) => item.toUpperCase() === normalized);
}

export async function writeWatchList(type: MarketType, list: string[]): Promise<void> {
  await getConfig().update(getConfigKeyForType(type), list, vscode.ConfigurationTarget.Global);
}

export function reorderList(list: string[], fromIndex: number, toIndex: number): string[] | undefined {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) {
    return undefined;
  }
  if (fromIndex === toIndex) {
    return undefined;
  }
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function isQuoteNode(nodeId: string | undefined): nodeId is string {
  return !!nodeId && isQuoteNodeId(nodeId);
}

export function nodeIdKey(nodeId: string): string {
  return marketKeyOf(parseMarketKey(nodeId).type, parseMarketKey(nodeId).symbol);
}
