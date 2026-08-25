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
exports.ReaderWebviewProvider = exports.selectReaderStealthSeconds = void 0;
const vscode = __importStar(require("vscode"));
const readerStealth_1 = require("./readerStealth");
Object.defineProperty(exports, "selectReaderStealthSeconds", { enumerable: true, get: function () { return readerStealth_1.selectReaderStealthSeconds; } });
function getNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
}
class ReaderWebviewProvider {
    constructor(reader, extensionUri) {
        this.reader = reader;
        this.extensionUri = extensionUri;
        this.htmlReady = false;
        this.stealthHidden = false;
        this.unlockArrowCount = 0;
        this.lastUnlockArrowAt = 0;
        reader.onDidChange(() => {
            if (!reader.currentBook) {
                this.stealthHidden = false;
                this.unlockArrowCount = 0;
            }
            this.pushUpdate();
        });
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        const webview = webviewView.webview;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
        };
        webview.onDidReceiveMessage(async (msg) => {
            if (msg?.type === 'ready') {
                this.pushUpdate();
            }
            else if (msg?.type === 'nextPage') {
                await this.handleNext();
            }
            else if (msg?.type === 'prevPage') {
                await this.handlePrev();
            }
            else if (msg?.type === 'open') {
                await vscode.commands.executeCommand('kanpan.readerOpen');
            }
            else if (msg?.type === 'stealthHidden') {
                this.stealthHidden = true;
                this.unlockArrowCount = 0;
            }
            else if (msg?.type === 'stealthShown') {
                this.stealthHidden = false;
                this.unlockArrowCount = 0;
            }
        });
        if (!this.htmlReady) {
            const nonce = getNonce();
            const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reader.css'));
            const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reader.js'));
            webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <link rel="stylesheet" href="${cssUri}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
            this.htmlReady = true;
        }
    }
    async handleNext() {
        if (this.consumeArrowUnlock()) {
            return;
        }
        await this.reader.nextPage();
    }
    async handlePrev() {
        if (this.consumeArrowUnlock()) {
            return;
        }
        await this.reader.prevPage();
    }
    consumeArrowUnlock() {
        if (!this.stealthHidden || (0, readerStealth_1.getReaderStealthSeconds)() <= 0) {
            return false;
        }
        const now = Date.now();
        if (now - this.lastUnlockArrowAt > 1200) {
            this.unlockArrowCount = 0;
        }
        this.lastUnlockArrowAt = now;
        this.unlockArrowCount += 1;
        if (this.unlockArrowCount >= 2) {
            this.unlockArrowCount = 0;
            this.revealFromStealth();
        }
        return true;
    }
    revealFromStealth() {
        this.stealthHidden = false;
        void this.view?.webview.postMessage({ type: 'setHidden', hidden: false });
    }
    refresh() {
        this.pushUpdate();
    }
    pushUpdate() {
        if (!this.view || !this.htmlReady) {
            return;
        }
        const book = this.reader.currentBook;
        if (!book) {
            void this.view.webview.postMessage({ type: 'update', mode: 'empty' });
            this.view.description = '未打开';
            return;
        }
        const lines = this.reader.getReadingWindow();
        const pageSize = lines.length || this.reader.currentPageSize;
        const prose = (0, readerStealth_1.joinProse)(lines) || '（本章暂无正文）';
        void this.view.webview.postMessage({
            type: 'update',
            mode: 'reading',
            chapter: this.reader.chapterTitle,
            progress: this.reader.progressLabel,
            prose,
            pageSize,
            stealthSeconds: (0, readerStealth_1.getReaderStealthSeconds)(),
            hidden: this.stealthHidden,
        });
        this.view.description = this.reader.progressLabel;
    }
}
exports.ReaderWebviewProvider = ReaderWebviewProvider;
ReaderWebviewProvider.viewType = 'kanpanView.readerText';
//# sourceMappingURL=readerWebview.js.map