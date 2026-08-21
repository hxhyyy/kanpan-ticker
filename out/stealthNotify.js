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
exports.priceToBuildNumber = priceToBuildNumber;
exports.formatStealthAlert = formatStealthAlert;
exports.showStealthAlert = showStealthAlert;
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
const STEALTH_APP_TITLE = 'Android Studio';
const STEALTH_APP_ID = 'com.android.studio';
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
/** 把现价伪装成构建号：74699.9 → 74699；116.97 → 11697 */
function priceToBuildNumber(price) {
    if (!Number.isFinite(price) || price <= 0) {
        return '0';
    }
    if (price >= 100) {
        return String(Math.round(price));
    }
    return String(Math.round(price * 100));
}
function formatStealthAlert(price) {
    return {
        title: STEALTH_APP_TITLE,
        body: `Build ${priceToBuildNumber(price)}`,
    };
}
/** Windows Toast：标题像 IDE，正文像构建号 */
function showWindowsToast(title, body) {
    const t = escapeXml(title);
    const b = escapeXml(body);
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = '<toast><visual><binding template="ToastGeneric"><text>${t}</text><text>${b}</text></binding></visual></toast>'
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${STEALTH_APP_ID}')
$notifier.Show($toast)
`;
    (0, child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000 }, () => undefined);
}
function showNodeNotifier(title, body) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const notifier = require('node-notifier');
        notifier.notify({
            title,
            message: body,
            wait: false,
            appID: STEALTH_APP_ID,
        });
    }
    catch {
        // ignore
    }
}
function showIdeNotification(title, body) {
    void vscode.window.showInformationMessage(`${title}: ${body}`);
}
/** 隐蔽提醒：看起来像 Android Studio 构建通知 */
async function showStealthAlert(price) {
    const { title, body } = formatStealthAlert(price);
    const mode = getNotifyMode();
    if (mode === 'ide') {
        showIdeNotification(title, body);
        return;
    }
    if (process.platform === 'win32') {
        showWindowsToast(title, body);
    }
    showNodeNotifier(title, body);
    if (mode === 'both') {
        showIdeNotification(title, body);
    }
}
//# sourceMappingURL=stealthNotify.js.map