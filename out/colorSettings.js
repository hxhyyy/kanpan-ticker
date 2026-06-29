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
exports.COLOR_SCHEME_OPTIONS = void 0;
exports.getColorSchemeLabel = getColorSchemeLabel;
exports.getRiseFallColors = getRiseFallColors;
exports.isValidHexColor = isValidHexColor;
exports.toStatusBarReadableColor = toStatusBarReadableColor;
exports.applyStatusBarItemColors = applyStatusBarItemColors;
exports.clearStatusBarItemColors = clearStatusBarItemColors;
exports.coloredTrendIcon = coloredTrendIcon;
exports.syncKanpanThemeColors = syncKanpanThemeColors;
exports.initKanpanThemeColors = initKanpanThemeColors;
exports.applyColorScheme = applyColorScheme;
exports.selectColorScheme = selectColorScheme;
exports.setCustomColor = setCustomColor;
const vscode = __importStar(require("vscode"));
const GREEN_COLOR = '#089981';
const RED_COLOR = '#ef5350';
exports.COLOR_SCHEME_OPTIONS = [
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
function kanpanConfig() {
    return vscode.workspace.getConfiguration('kanpan');
}
function getColorSchemeLabel(scheme) {
    const option = exports.COLOR_SCHEME_OPTIONS.find((item) => item.id === scheme);
    return option ? `${option.label}（${option.description}）` : scheme;
}
function getRiseFallColors(config = kanpanConfig()) {
    const scheme = config.get('colorScheme', 'us');
    if (scheme === 'cn') {
        return { rise: RED_COLOR, fall: GREEN_COLOR, scheme };
    }
    if (scheme === 'custom') {
        return {
            rise: config.get('riseColor', GREEN_COLOR),
            fall: config.get('fallColor', RED_COLOR),
            scheme,
        };
    }
    return { rise: GREEN_COLOR, fall: RED_COLOR, scheme: 'us' };
}
function isValidHexColor(value) {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}
function parseHexColor(hex) {
    const raw = hex.replace('#', '');
    const normalized = raw.length === 3
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
function toStatusBarReadableColor(hex) {
    const { r, g, b } = parseHexColor(hex);
    if (g > r * 1.15 && g > b * 0.9) {
        return '#86EFAC';
    }
    if (r > g * 1.15) {
        return '#FCA5A5';
    }
    return '#FFFFFF';
}
function applyStatusBarItemColors(statusBarItem, changePercent, monochrome, rise, fall) {
    statusBarItem.backgroundColor = undefined;
    if (monochrome) {
        statusBarItem.color = undefined;
        return;
    }
    const trendColor = changePercent >= 0 ? rise : fall;
    statusBarItem.color = toStatusBarReadableColor(trendColor);
}
function clearStatusBarItemColors(statusBarItem) {
    statusBarItem.color = undefined;
    statusBarItem.backgroundColor = undefined;
}
function coloredTrendIcon(up, color) {
    const path = up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
        `stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="${path}"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
async function syncKanpanThemeColors(rise, fall) {
    const workbench = vscode.workspace.getConfiguration('workbench');
    const current = { ...(workbench.get('colorCustomizations') ?? {}) };
    current['kanpan.rise'] = rise;
    current['kanpan.fall'] = fall;
    await workbench.update('colorCustomizations', current, vscode.ConfigurationTarget.Global);
}
async function initKanpanThemeColors() {
    const { rise, fall } = getRiseFallColors();
    await syncKanpanThemeColors(rise, fall);
}
async function applyColorScheme(scheme) {
    const config = kanpanConfig();
    const option = exports.COLOR_SCHEME_OPTIONS.find((item) => item.id === scheme);
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
async function selectColorScheme() {
    const config = kanpanConfig();
    const current = config.get('colorScheme', 'us');
    const picked = await vscode.window.showQuickPick(exports.COLOR_SCHEME_OPTIONS.map((option) => ({
        label: option.id === current ? `$(check) ${option.label}` : option.label,
        description: option.description,
        detail: `涨 ${option.riseColor}  跌 ${option.fallColor}`,
        id: option.id,
    })), {
        title: '看盘插件 - 涨跌颜色',
        placeHolder: '选择颜色习惯',
    });
    if (!picked) {
        return;
    }
    await applyColorScheme(picked.id);
    vscode.window.showInformationMessage(`涨跌颜色已切换为：${getColorSchemeLabel(picked.id)}`);
}
async function setCustomColor(kind) {
    const config = kanpanConfig();
    const key = kind === 'rise' ? 'riseColor' : 'fallColor';
    const current = config.get(key, kind === 'rise' ? GREEN_COLOR : RED_COLOR);
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
//# sourceMappingURL=colorSettings.js.map