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
exports.createStockDragController = createStockDragController;
exports.createCryptoDragController = createCryptoDragController;
exports.getConfigKeyForType = getConfigKeyForType;
exports.normalizeWatchSymbol = normalizeWatchSymbol;
exports.readWatchList = readWatchList;
exports.indexInWatchList = indexInWatchList;
exports.writeWatchList = writeWatchList;
exports.reorderList = reorderList;
exports.isQuoteNode = isQuoteNode;
exports.nodeIdKey = nodeIdKey;
const vscode = __importStar(require("vscode"));
const aShareSources_1 = require("../aShareSources");
const marketService_1 = require("../marketService");
const STOCK_TREE_MIME = 'application/vnd.code.tree.kanpanview.stock';
const CRYPTO_TREE_MIME = 'application/vnd.code.tree.kanpanview.crypto';
function isQuoteNodeId(nodeId) {
    return /^(stock|ashare|crypto):/.test(nodeId);
}
function createDragController(mimeType, allowedTypes, reorder, refresh) {
    return {
        dragMimeTypes: [mimeType],
        dropMimeTypes: [mimeType],
        handleDrag(source, dataTransfer) {
            const item = source[0];
            if (!item || !isQuoteNodeId(item.nodeId)) {
                return;
            }
            const parsed = (0, marketService_1.parseMarketKey)(item.nodeId);
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
function createStockDragController(reorder, refresh) {
    return createDragController(STOCK_TREE_MIME, ['stock', 'ashare'], reorder, refresh);
}
function createCryptoDragController(reorder, refresh) {
    return createDragController(CRYPTO_TREE_MIME, ['crypto'], reorder, refresh);
}
function getConfigKeyForType(type) {
    if (type === 'stock') {
        return 'stocks';
    }
    if (type === 'ashare') {
        return 'aShares';
    }
    return 'cryptoSymbols';
}
function normalizeWatchSymbol(type, symbol) {
    if (type === 'ashare') {
        return (0, aShareSources_1.normalizeAShareCode)(symbol);
    }
    return symbol.toUpperCase();
}
function readWatchList(type) {
    const config = (0, marketService_1.getConfig)();
    const key = getConfigKeyForType(type);
    const defaults = type === 'stock' ? ['AAPL', 'NVDA', 'TSLA'] : type === 'ashare' ? ['sh600519', 'sz300750'] : ['BTCUSDT'];
    return config.get(key, defaults).map((symbol) => normalizeWatchSymbol(type, symbol));
}
function indexInWatchList(type, symbol, list) {
    const normalized = normalizeWatchSymbol(type, symbol);
    if (type === 'ashare') {
        return list.findIndex((item) => (0, aShareSources_1.normalizeAShareCode)(item) === normalized);
    }
    return list.findIndex((item) => item.toUpperCase() === normalized);
}
async function writeWatchList(type, list) {
    await (0, marketService_1.getConfig)().update(getConfigKeyForType(type), list, vscode.ConfigurationTarget.Global);
}
function reorderList(list, fromIndex, toIndex) {
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
function isQuoteNode(nodeId) {
    return !!nodeId && isQuoteNodeId(nodeId);
}
function nodeIdKey(nodeId) {
    return (0, marketService_1.marketKeyOf)((0, marketService_1.parseMarketKey)(nodeId).type, (0, marketService_1.parseMarketKey)(nodeId).symbol);
}
//# sourceMappingURL=reorder.js.map