import * as vscode from 'vscode';

export type ColorSchemeId = 'us' | 'cn' | 'custom';

export interface ColorSchemeOption {
  id: ColorSchemeId;
  label: string;
  description: string;
  riseColor: string;
  fallColor: string;
}

const GREEN_COLOR = '#089981';
const RED_COLOR = '#ef5350';

export const COLOR_SCHEME_OPTIONS: ColorSchemeOption[] = [
  {
    id: 'us',
    label: '美国惯例',
    description: '绿涨红跌',
    riseColor: GREEN_COLOR,
    fallColor: RED_COLOR,
  },
  {
    id: 'cn',
    label: '中国惯例',
    description: '红涨绿跌',
    riseColor: RED_COLOR,
    fallColor: GREEN_COLOR,
  },
  {
    id: 'custom',
    label: '自定义',
    description: '手动设置涨跌颜色',
    riseColor: GREEN_COLOR,
    fallColor: RED_COLOR,
  },
];

function kanpanConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('kanpan');
}

export function getColorSchemeLabel(scheme: ColorSchemeId): string {
  const option = COLOR_SCHEME_OPTIONS.find((item) => item.id === scheme);
  return option ? `${option.label}（${option.description}）` : scheme;
}

export function getRiseFallColors(config = kanpanConfig()): {
  rise: string;
  fall: string;
  scheme: ColorSchemeId;
} {
  const scheme = config.get<ColorSchemeId>('colorScheme', 'us');
  if (scheme === 'cn') {
    return { rise: RED_COLOR, fall: GREEN_COLOR, scheme };
  }
  if (scheme === 'custom') {
    return {
      rise: config.get<string>('riseColor', GREEN_COLOR),
      fall: config.get<string>('fallColor', RED_COLOR),
      scheme,
    };
  }
  return { rise: GREEN_COLOR, fall: RED_COLOR, scheme: 'us' };
}

export function isValidHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '');
  const normalized =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

/** 状态栏背景通常是蓝色/深色，使用高对比亮色文字 */
export function toStatusBarReadableColor(hex: string): string {
  const { r, g, b } = parseHexColor(hex);
  if (g > r * 1.15 && g > b * 0.9) {
    return '#86EFAC';
  }
  if (r > g * 1.15) {
    return '#FCA5A5';
  }
  return '#FFFFFF';
}

export function applyStatusBarItemColors(
  statusBarItem: vscode.StatusBarItem,
  changePercent: number,
  monochrome: boolean,
  rise: string,
  fall: string
): void {
  statusBarItem.backgroundColor = undefined;
  if (monochrome) {
    statusBarItem.color = undefined;
    return;
  }
  const trendColor = changePercent >= 0 ? rise : fall;
  statusBarItem.color = toStatusBarReadableColor(trendColor);
}

export function clearStatusBarItemColors(statusBarItem: vscode.StatusBarItem): void {
  statusBarItem.color = undefined;
  statusBarItem.backgroundColor = undefined;
}

export function coloredTrendIcon(up: boolean, color: string): vscode.Uri {
  const path = up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${path}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

export async function syncKanpanThemeColors(rise: string, fall: string): Promise<void> {  const workbench = vscode.workspace.getConfiguration('workbench');
  const current = { ...(workbench.get<Record<string, string>>('colorCustomizations') ?? {}) };
  current['kanpan.rise'] = rise;
  current['kanpan.fall'] = fall;
  await workbench.update('colorCustomizations', current, vscode.ConfigurationTarget.Global);
}

export async function initKanpanThemeColors(): Promise<void> {
  const { rise, fall } = getRiseFallColors();
  await syncKanpanThemeColors(rise, fall);
}

export async function applyColorScheme(scheme: ColorSchemeId): Promise<void> {
  const config = kanpanConfig();
  const option = COLOR_SCHEME_OPTIONS.find((item) => item.id === scheme);
  if (!option) {
    return;
  }

  await config.update('colorScheme', scheme, vscode.ConfigurationTarget.Global);
  if (scheme !== 'custom') {
    await config.update('riseColor', option.riseColor, vscode.ConfigurationTarget.Global);
    await config.update('fallColor', option.fallColor, vscode.ConfigurationTarget.Global);
    await syncKanpanThemeColors(option.riseColor, option.fallColor);
  }
}

export async function selectColorScheme(): Promise<void> {
  const config = kanpanConfig();
  const current = config.get<ColorSchemeId>('colorScheme', 'us');
  const picked = await vscode.window.showQuickPick(
    COLOR_SCHEME_OPTIONS.map((option) => ({
      label: option.id === current ? `$(check) ${option.label}` : option.label,
      description: option.description,
      detail: `涨 ${option.riseColor}  跌 ${option.fallColor}`,
      id: option.id,
    })),
    {
      title: '看盘插件 - 涨跌颜色',
      placeHolder: '选择颜色习惯',
    }
  );
  if (!picked) {
    return;
  }

  await applyColorScheme(picked.id);
  vscode.window.showInformationMessage(`涨跌颜色已切换为：${getColorSchemeLabel(picked.id)}`);
}

export async function setCustomColor(kind: 'rise' | 'fall'): Promise<void> {
  const config = kanpanConfig();
  const key = kind === 'rise' ? 'riseColor' : 'fallColor';
  const current = config.get<string>(key, kind === 'rise' ? GREEN_COLOR : RED_COLOR);
  const title = kind === 'rise' ? '上涨颜色' : '下跌颜色';

  const value = await vscode.window.showInputBox({
    prompt: `输入${title}（十六进制，如 #ef5350）`,
    value: current,
    validateInput: (input) => (isValidHexColor(input) ? undefined : '请输入 #RGB 或 #RRGGBB 格式'),
  });
  if (!value) {
    return;
  }

  await config.update('colorScheme', 'custom', vscode.ConfigurationTarget.Global);
  await config.update(key, value.trim(), vscode.ConfigurationTarget.Global);
  const colors = getRiseFallColors();
  await syncKanpanThemeColors(colors.rise, colors.fall);
  vscode.window.showInformationMessage(`${title}已设为 ${value.trim()}`);
}
