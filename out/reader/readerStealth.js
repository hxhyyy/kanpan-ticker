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
exports.getReaderStealthSeconds = getReaderStealthSeconds;
exports.selectReaderStealthSeconds = selectReaderStealthSeconds;
exports.joinProse = joinProse;
exports.splitProseLines = splitProseLines;
const vscode = __importStar(require("vscode"));
function getReaderStealthSeconds() {
    const raw = vscode.workspace.getConfiguration('kanpan').get('readerStealthSeconds', 10);
    if (!Number.isFinite(raw) || raw <= 0) {
        return 0;
    }
    return Math.min(600, Math.max(1, Math.round(raw)));
}
async function selectReaderStealthSeconds() {
    const config = vscode.workspace.getConfiguration('kanpan');
    const current = config.get('readerStealthSeconds', 10);
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
/** Join sentences into continuous prose. */
function joinProse(parts) {
    if (parts.length === 0) {
        return '';
    }
    let out = parts[0];
    for (let i = 1; i < parts.length; i++) {
        const prev = out;
        const next = parts[i];
        const prevLast = prev.slice(-1);
        const needsSpace = /[A-Za-z0-9]$/.test(prevLast) && /^[A-Za-z0-9]/.test(next);
        out += needsSpace ? ` ${next}` : next;
    }
    return out;
}
/** Split prose into sidebar-friendly lines (complete phrases, no ellipsis). */
function splitProseLines(prose, maxChars = 38, maxLines = 5) {
    if (!prose) {
        return [];
    }
    const lines = [];
    let rest = prose;
    while (rest.length > 0 && lines.length < maxLines) {
        if (rest.length <= maxChars) {
            lines.push(rest);
            break;
        }
        let cut = maxChars;
        const slice = rest.slice(0, maxChars + 1);
        const breakAt = Math.max(slice.lastIndexOf('，'), slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'), slice.lastIndexOf('、'), slice.lastIndexOf(' '), slice.lastIndexOf(','));
        if (breakAt > maxChars * 0.4) {
            cut = breakAt + 1;
        }
        lines.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest.length > 0 && lines.length > 0) {
        lines[lines.length - 1] += rest;
    }
    return lines;
}
//# sourceMappingURL=readerStealth.js.map