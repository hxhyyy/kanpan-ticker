import { execFile } from 'child_process';
import * as vscode from 'vscode';

export type AlertNotifyMode = 'system' | 'ide' | 'both';

function getNotifyMode(): AlertNotifyMode {
  const mode = vscode.workspace.getConfiguration('kanpan').get<string>('alertNotifyMode', 'both');
  if (mode === 'ide' || mode === 'both' || mode === 'system') {
    return mode;
  }
  return 'both';
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Windows Toast：成功与否不可靠（未注册 AppId 时常静默失败），仅作尽力而为 */
function showWindowsToast(message: string): void {
  const safe = escapeXml(message);
  const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = '<toast><visual><binding template="ToastGeneric"><text>${safe}</text></binding></visual></toast>'
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Kanpan.Ticker')
$notifier.Show($toast)
`;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 8000 },
    () => undefined
  );
}

function showNodeNotifier(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const notifier = require('node-notifier') as typeof import('node-notifier');
      notifier.notify(
        {
          title: ' ',
          message,
          wait: false,
          appID: 'Kanpan.Ticker',
        },
        (err) => resolve(!err)
      );
      // 部分环境下 callback 不触发，短延迟后视为已尝试
      setTimeout(() => resolve(true), 1500);
    } catch {
      resolve(false);
    }
  });
}

function showIdeNotification(message: string): void {
  void vscode.window.showInformationMessage(message);
}

/**
 * 隐蔽提醒：只显示数字。
 * 默认 both（系统 + 编辑器），避免 Windows Toast 静默失败导致完全看不到。
 */
export async function showStealthAlert(message: string): Promise<void> {
  const mode = getNotifyMode();

  if (mode === 'ide') {
    showIdeNotification(message);
    return;
  }

  if (mode === 'system' || mode === 'both') {
    if (process.platform === 'win32') {
      showWindowsToast(message);
    }
    void showNodeNotifier(message);
  }

  // system 模式也回退 IDE，保证至少能看到一次
  if (mode === 'both' || mode === 'system') {
    showIdeNotification(message);
  }
}
