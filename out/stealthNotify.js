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
exports.initStealthNotify = initStealthNotify;
exports.priceToBuildNumber = priceToBuildNumber;
exports.formatStealthAlert = formatStealthAlert;
exports.showStealthAlert = showStealthAlert;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const STEALTH_APP_ID = 'Android Studio';
const ICON_RISE_RELATIVE = path.join('resources', 'android-studio-toast.png');
const ICON_FALL_RELATIVE = path.join('resources', 'android-studio-toast-fall.png');
let extensionRoot;
const cachedIconPaths = {};
let cachedAppId = STEALTH_APP_ID;
function initStealthNotify(context) {
    extensionRoot = context.extensionPath;
    cachedIconPaths.rise = undefined;
    cachedIconPaths.fall = undefined;
    cachedAppId = STEALTH_APP_ID;
    // 后台探测本机 Android Studio 的真实 AppId（不阻塞激活）
    if (process.platform === 'win32') {
        setTimeout(() => {
            try {
                resolveAppId(true);
            }
            catch {
                // ignore
            }
        }, 1500);
    }
}
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
function toFileUri(filePath) {
    const normalized = path.resolve(filePath).replace(/\\/g, '/');
    const raw = /^[A-Za-z]:/.test(normalized) ? `file:///${normalized}` : `file://${normalized}`;
    // 路径含中文时必须编码，否则 Toast 图标加载失败
    return encodeURI(raw);
}
function getIconPath(rising = true) {
    const cacheKey = rising ? 'rise' : 'fall';
    const cached = cachedIconPaths[cacheKey];
    if (cached && fs.existsSync(cached)) {
        return cached;
    }
    const relative = rising ? ICON_RISE_RELATIVE : ICON_FALL_RELATIVE;
    const candidates = [
        extensionRoot ? path.join(extensionRoot, relative) : undefined,
        path.join(__dirname, '..', relative),
    ].filter((p) => Boolean(p));
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            cachedIconPaths[cacheKey] = candidate;
            return candidate;
        }
    }
    if (!rising) {
        return getIconPath(true);
    }
    return undefined;
}
/** 优先用本机已安装的 Android Studio 快捷方式 AppId，顶部更像真应用 */
function resolveAppId(forceProbe = false) {
    if (!forceProbe) {
        return cachedAppId;
    }
    try {
        const script = `
$ErrorActionPreference = 'SilentlyContinue'
$apps = Get-StartApps | Where-Object { $_.Name -match 'Android Studio' }
if ($apps) { ($apps | Select-Object -First 1).AppID }
`;
        const out = (0, child_process_1.execFileSync)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000, encoding: 'utf8' }).trim();
        if (out && out.length > 0 && out.length < 260) {
            cachedAppId = out;
        }
    }
    catch {
        // keep fallback
    }
    return cachedAppId;
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
    const build = priceToBuildNumber(price);
    return {
        title: `Done • Android Studio build ${build}`,
        body: 'Open project to view the output.',
    };
}
/** Windows Toast：标题像 IDE，正文像构建号，左侧用 AS 风格图标 */
function showWindowsToast(title, body, rising) {
    const t = escapeXml(title);
    const b = escapeXml(body);
    const iconPath = getIconPath(rising);
    const appIdPs = resolveAppId().replace(/'/g, "''");
    const imageXml = iconPath
        ? `<image placement="appLogoOverride" hint-crop="circle" src="${escapeXml(toFileUri(iconPath))}"/>`
        : '';
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = '<toast><visual><binding template="ToastGeneric"><text>${t}</text><text>${b}</text>${imageXml}</binding></visual></toast>'
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appIdPs}')
$notifier.Show($toast)
`;
    try {
        (0, child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000 }, () => undefined);
        return true;
    }
    catch {
        return false;
    }
}
function showNodeNotifier(title, body, rising) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const notifier = require('node-notifier');
        const icon = getIconPath(rising);
        notifier.notify({
            title,
            message: body,
            wait: false,
            appID: cachedAppId,
            ...(icon ? { icon } : {}),
        });
    }
    catch {
        // ignore
    }
}
function showIdeNotification(title, body) {
    void vscode.window.showInformationMessage(`${title}: ${body}`);
}
/** 隐蔽提醒：看起来像 Android Studio 构建通知；涨用绿底图标，跌用红底图标 */
async function showStealthAlert(price, rising = true) {
    const { title, body } = formatStealthAlert(price);
    const mode = getNotifyMode();
    if (mode === 'ide') {
        showIdeNotification(title, body);
        return;
    }
    if (process.platform === 'win32') {
        // 只走一条 Windows Toast，避免再弹 node-notifier 默认吐司图
        showWindowsToast(title, body, rising);
    }
    else {
        showNodeNotifier(title, body, rising);
    }
    if (mode === 'both') {
        showIdeNotification(title, body);
    }
}
//# sourceMappingURL=stealthNotify.js.map