import { execFile } from 'child_process';
import * as vscode from 'vscode';

export type AlertNotifyMode = 'system' | 'ide' | 'both';

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

/** Windows 通知中心 Toast */
function showWindowsToast(message: string): Promise<boolean> {
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
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      (error) => resolve(!error)
    );
  });
}

async function showNodeNotifier(message: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notifier = require('node-notifier') as typeof import('node-notifier');
    await new Promise<void>((resolve, reject) => {
      notifier.notify(
        {
          title: ' ',
          message,
          wait: false,
          appID: 'Cursor.Kanpan',
        },
        (err) => (err ? reject(err) : resolve())
      );
    });
    return true;
  } catch {
    return false;
  }
}

async function showSystemNotification(message: string): Promise<boolean> {
  if (process.platform === 'win32') {
    if (await showWindowsToast(message)) {
      return true;
    }
  }
  return showNodeNotifier(message);
}

function showIdeNotification(message: string): void {
  void vscode.window.showInformationMessage(message);
}

/** 隐蔽提醒：默认系统通知，只显示传入的数字文案 */
export async function showStealthAlert(message: string): Promise<void> {
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
