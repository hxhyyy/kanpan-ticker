import * as vscode from 'vscode';

export function getReaderStealthSeconds(): number {
  const raw = vscode.workspace.getConfiguration('kanpan').get<number>('readerStealthSeconds', 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.min(600, Math.max(1, Math.round(raw)));
}

export async function selectReaderStealthSeconds(): Promise<void> {
  const config = vscode.workspace.getConfiguration('kanpan');
  const current = config.get<number>('readerStealthSeconds', 10);
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
export function joinProse(parts: string[]): string {
  if (parts.length === 0) {
    return '';
  }
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const prev = out;
    const next = parts[i];
    const prevLast = prev.slice(-1);
    const needsSpace =
      /[A-Za-z0-9]$/.test(prevLast) && /^[A-Za-z0-9]/.test(next);
    out += needsSpace ? ` ${next}` : next;
  }
  return out;
}

/** Split prose into sidebar-friendly lines (complete phrases, no ellipsis). */
export function splitProseLines(prose: string, maxChars = 38, maxLines = 5): string[] {
  if (!prose) {
    return [];
  }
  const lines: string[] = [];
  let rest = prose;
  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      break;
    }
    let cut = maxChars;
    const slice = rest.slice(0, maxChars + 1);
    const breakAt = Math.max(
      slice.lastIndexOf('，'),
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('、'),
      slice.lastIndexOf(' '),
      slice.lastIndexOf(',')
    );
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
