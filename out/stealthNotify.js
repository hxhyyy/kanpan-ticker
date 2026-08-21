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
exports.showStealthAlert = showStealthAlert;
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
function getNotifyMode() {
    const mode = vscode.workspace.getConfiguration('kanpan').get('alertNotifyMode', 'system');
    if (mode === 'ide' || mode === 'both' || mode === 'system') {
        return mode;
    }
    return 'system';
}
function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
/** Windows 通知中心 Toast */
function showWindowsToast(message) {
    return new Promise((resolve) => {
        const safe = escapeXml(message);
        const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = '<toast><visual><binding template="ToastGeneric"><text>${safe}</text></binding></visual></toast>'
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Cursor.Kanpan')
$notifier.Show($toast)
`;
        (0, child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000 }, (error) => resolve(!error));
    });
}
async function showNodeNotifier(message) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const notifier = require('node-notifier');
        await new Promise((resolve, reject) => {
            notifier.notify({
                title: ' ',
                message,
                wait: false,
                appID: 'Cursor.Kanpan',
            }, (err) => (err ? reject(err) : resolve()));
        });
        return true;
    }
    catch {
        return false;
    }
}
async function showSystemNotification(message) {
    if (process.platform === 'win32') {
        if (await showWindowsToast(message)) {
            return true;
        }
    }
    return showNodeNotifier(message);
}
function showIdeNotification(message) {
    void vscode.window.showInformationMessage(message);
}
/** 隐蔽提醒：默认系统通知，只显示传入的数字文案 */
async function showStealthAlert(message) {
    const mode = getNotifyMode();
    if (mode === 'ide') {
        showIdeNotification(message);
        return;
    }
    if (mode === 'both') {
        showIdeNotification(message);
        await showSystemNotification(message);
        return;
    }
    const ok = await showSystemNotification(message);
    if (!ok) {
        showIdeNotification(message);
    }
}
//# sourceMappingURL=stealthNotify.js.map