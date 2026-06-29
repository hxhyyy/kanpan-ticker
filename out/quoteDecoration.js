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
exports.QuoteDecorationProvider = void 0;
exports.quoteDecorationUri = quoteDecorationUri;
const vscode = __importStar(require("vscode"));
const providers_1 = require("./providers");
function quoteDecorationUri(key, changePercent) {
    return vscode.Uri.from({
        scheme: 'kanpan-quote',
        path: `/${encodeURIComponent(key)}`,
        query: `change=${changePercent}`,
    });
}
class QuoteDecorationProvider {
    constructor() {
        this.onDidChangeEmitter = new vscode.EventEmitter();
        this.onDidChangeFileDecorations = this.onDidChangeEmitter.event;
    }
    refresh() {
        this.onDidChangeEmitter.fire(undefined);
    }
    dispose() {
        this.onDidChangeEmitter.dispose();
    }
    provideFileDecoration(uri) {
        if (uri.scheme !== 'kanpan-quote') {
            return undefined;
        }
        const match = uri.query.match(/change=(-?\d+(?:\.\d+)?)/);
        if (!match) {
            return undefined;
        }
        const change = parseFloat(match[1]);
        if (!Number.isFinite(change)) {
            return undefined;
        }
        return {
            badge: (0, providers_1.formatChangePercent)(change),
            color: new vscode.ThemeColor(change >= 0 ? 'kanpan.rise' : 'kanpan.fall'),
            tooltip: (0, providers_1.formatChangePercent)(change),
        };
    }
}
exports.QuoteDecorationProvider = QuoteDecorationProvider;
//# sourceMappingURL=quoteDecoration.js.map