import * as vscode from 'vscode';

export type ColorSchemeId = 'us' | 'cn' | 'custom' | 'none';

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
  {
    id: 'none',
    label: '无颜色',
    description: '涨跌不显示颜色，使用默认字体',
    riseColor: GREEN_COLOR,
    fallColor: RED_COLOR,
  },
];

/** 是否使用默认字体显示涨跌（不着色、不显示彩色箭头） */
export function shouldUseNeutralColors(config = kanpanConfig()): boolean {
  const scheme = config.get<ColorSchemeId>('colorScheme', 'us');
  return scheme === 'none' || config.get<boolean>('monochrome', false);
}

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
  if (scheme === 'none') {
    return { rise: GREEN_COLOR, fall: RED_COLOR, scheme };
  }
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
  fall: string,
  brightness = getStatusBarBrightness()
): void {
  statusBarItem.backgroundColor = undefined;
  if (monochrome) {
    statusBarItem.color = statusBarNeutralColor(brightness);
    return;
  }
  const trendColor = changePercent >= 0 ? rise : fall;
  const readable = toStatusBarReadableColor(trendColor);
  statusBarItem.color = applyBrightnessToHex(readable, brightness);
}

export function clearStatusBarItemColors(statusBarItem: vscode.StatusBarItem): void {
  statusBarItem.color = undefined;
  statusBarItem.backgroundColor = undefined;
}

/** 底部状态栏文字深浅：10 最暗，100 最亮 */
export function getStatusBarBrightness(config = kanpanConfig()): number {
  const raw = config.get<number>('statusBarBrightness', 100);
  if (!Number.isFinite(raw)) {
    return 100;
  }
  return Math.max(10, Math.min(100, Math.round(raw)));
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string {
  return `#${[clampByte(r), clampByte(g), clampByte(b)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** 把颜色按深浅压暗（朝状态栏深灰靠拢），复用点亮淡出那套观感 */
export function applyBrightnessToHex(hex: string, brightness: number): string {
  const t = Math.max(10, Math.min(100, brightness)) / 100;
  const { r, g, b } = parseHexColor(hex);
  const base = 0x2d;
  return toHex(base + (r - base) * t, base + (g - base) * t, base + (b - base) * t);
}

/** 中性灰阶：与点亮后淡出梯度同一路（亮 → 暗） */
export function statusBarNeutralColor(brightness: number): string {
  const t = (Math.max(10, Math.min(100, brightness)) - 10) / 90;
  const dark = 0x2d;
  const light = 0xe0;
  const v = Math.round(dark + (light - dark) * t);
  return toHex(v, v, v);
}

/** 点亮结束淡出：从当前深浅逐步压到最暗 */
export function statusBarFadeOutColors(startBrightness: number, steps = 5): string[] {
  const start = Math.max(10, Math.min(100, startBrightness));
  const end = 10;
  const colors: string[] = [];
  for (let i = 1; i <= steps; i++) {
    const b = start - ((start - end) * i) / steps;
    colors.push(statusBarNeutralColor(b));
  }
  return colors;
}

export async function selectStatusBarBrightness(): Promise<void> {
  const config = kanpanConfig();
  const current = getStatusBarBrightness(config);
  const presets = [
    { label: '最亮', brightness: 100, description: '默认，最清晰' },
    { label: '偏亮', brightness: 80, description: '略压一点' },
    { label: '适中', brightness: 55, description: '接近点亮后第一档灰' },
    { label: '偏暗', brightness: 35, description: '更隐蔽' },
    { label: '很暗', brightness: 20, description: '接近淡出末档' },
    { label: '自定义…', brightness: -1, description: '输入 10–100' },
  ];

  const picked = await vscode.window.showQuickPick(
    presets.map((item) => ({
      label: item.brightness === current ? `$(check) ${item.label}` : item.label,
      description: item.brightness > 0 ? `${item.brightness}%` : undefined,
      detail: item.description,
      brightness: item.brightness,
    })),
    {
      title: '看盘插件 - 底部字体深浅',
      placeHolder: `当前 ${current}%`,
    }
  );
  if (!picked) {
    return;
  }

  let next = picked.brightness;
  if (next < 0) {
    const input = await vscode.window.showInputBox({
      prompt: '底部字体深浅（10 最暗，100 最亮）',
      value: String(current),
      validateInput: (value) => {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 10 || n > 100) {
          return '请输入 10–100 的数字';
        }
        return undefined;
      },
    });
    if (!input) {
      return;
    }
    next = Math.round(Number(input));
  }

  await config.update('statusBarBrightness', next, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`底部字体深浅已设为 ${next}%`);
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
  if (scheme === 'none') {
    return;
  }
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
      detail:
        option.id === 'none'
          ? '涨跌幅保留，文字与图标不着色'
          : `涨 ${option.riseColor}  跌 ${option.fallColor}`,
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
