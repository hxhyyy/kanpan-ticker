import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type AlertNotifyMode = 'system' | 'ide' | 'both';

const STEALTH_APP_ID = 'Android Studio';
const ICON_RISE_RELATIVE = path.join('resources', 'android-studio-toast.png');
const ICON_FALL_RELATIVE = path.join('resources', 'android-studio-toast-fall.png');

let extensionRoot: string | undefined;
const cachedIconPaths: { rise?: string; fall?: string } = {};
let cachedAppId: string = STEALTH_APP_ID;

export function initStealthNotify(context: vscode.ExtensionContext): void {
  extensionRoot = context.extensionPath;
  cachedIconPaths.rise = undefined;
  cachedIconPaths.fall = undefined;
  cachedAppId = STEALTH_APP_ID;
  // 后台探测本机 Android Studio 的真实 AppId（不阻塞激活）
  if (process.platform === 'win32') {
    setTimeout(() => {
      try {
        resolveAppId(true);
      } catch {
        // ignore
      }
    }, 1500);
  }
}

function getNotifyMode(): AlertNotifyMode {
  const mode = vscode.workspace.getConfiguration('kanpan').get<string>('alertNotifyMode', 'system');
  if (mode === 'ide' || mode === 'both' || mode === 'system') {
    return mode;
  }
  return 'system';
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toFileUri(filePath: string): string {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  const raw = /^[A-Za-z]:/.test(normalized) ? `file:///${normalized}` : `file://${normalized}`;
  // 路径含中文时必须编码，否则 Toast 图标加载失败
  return encodeURI(raw);
}

function getIconPath(rising = true): string | undefined {
  const cacheKey = rising ? 'rise' : 'fall';
  const cached = cachedIconPaths[cacheKey];
  if (cached && fs.existsSync(cached)) {
    return cached;
  }
  const relative = rising ? ICON_RISE_RELATIVE : ICON_FALL_RELATIVE;
  const candidates = [
    extensionRoot ? path.join(extensionRoot, relative) : undefined,
    path.join(__dirname, '..', relative),
  ].filter((p): p is string => Boolean(p));

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
function resolveAppId(forceProbe = false): string {
  if (!forceProbe) {
    return cachedAppId;
  }
  try {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$apps = Get-StartApps | Where-Object { $_.Name -match 'Android Studio' }
if ($apps) { ($apps | Select-Object -First 1).AppID }
`;
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000, encoding: 'utf8' }
    ).trim();
    if (out && out.length > 0 && out.length < 260) {
      cachedAppId = out;
    }
  } catch {
    // keep fallback
  }
  return cachedAppId;
}

/** 把现价伪装成构建号：74699.9 → 74699；116.97 → 11697 */
export function priceToBuildNumber(price: number): string {
  if (!Number.isFinite(price) || price <= 0) {
    return '0';
  }
  if (price >= 100) {
    return String(Math.round(price));
  }
  return String(Math.round(price * 100));
}

export function formatStealthAlert(price: number): { title: string; body: string } {
  const build = priceToBuildNumber(price);
  return {
    title: `Done • Android Studio build ${build}`,
    body: 'Open project to view the output.',
  };
}

/** Windows Toast：标题像 IDE，正文像构建号，左侧用 AS 风格图标 */
function showWindowsToast(title: string, body: string, rising: boolean): boolean {
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
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      () => undefined
    );
    return true;
  } catch {
    return false;
  }
}

function showNodeNotifier(title: string, body: string, rising: boolean): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notifier = require('node-notifier') as typeof import('node-notifier');
    const icon = getIconPath(rising);
    notifier.notify({
      title,
      message: body,
      wait: false,
      appID: cachedAppId,
      ...(icon ? { icon } : {}),
    });
  } catch {
    // ignore
  }
}

function showIdeNotification(title: string, body: string): void {
  void vscode.window.showInformationMessage(`${title}: ${body}`);
}

/** 隐蔽提醒：看起来像 Android Studio 构建通知；涨用绿底图标，跌用红底图标 */
export async function showStealthAlert(price: number, rising = true): Promise<void> {
  const { title, body } = formatStealthAlert(price);
  const mode = getNotifyMode();

  if (mode === 'ide') {
    showIdeNotification(title, body);
    return;
  }

  if (process.platform === 'win32') {
    // 只走一条 Windows Toast，避免再弹 node-notifier 默认吐司图
    showWindowsToast(title, body, rising);
  } else {
    showNodeNotifier(title, body, rising);
  }

  if (mode === 'both') {
    showIdeNotification(title, body);
  }
}
