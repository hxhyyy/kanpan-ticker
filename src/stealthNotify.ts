import { execFile } from 'child_process';
import * as vscode from 'vscode';

export type AlertNotifyMode = 'system' | 'ide' | 'both';

const STEALTH_APP_TITLE = 'Android Studio';
const STEALTH_APP_ID = 'com.android.studio';

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
  return {
    title: STEALTH_APP_TITLE,
    body: `Build ${priceToBuildNumber(price)}`,
  };
}

/** Windows Toast：标题像 IDE，正文像构建号 */
function showWindowsToast(title: string, body: string): void {
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
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 8000 },
    () => undefined
  );
}

function showNodeNotifier(title: string, body: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notifier = require('node-notifier') as typeof import('node-notifier');
    notifier.notify({
      title,
      message: body,
      wait: false,
      appID: STEALTH_APP_ID,
    });
  } catch {
    // ignore
  }
}

function showIdeNotification(title: string, body: string): void {
  void vscode.window.showInformationMessage(`${title}: ${body}`);
}

/** 隐蔽提醒：看起来像 Android Studio 构建通知 */
export async function showStealthAlert(price: number): Promise<void> {
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
