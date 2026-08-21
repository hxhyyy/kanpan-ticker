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
exports.getPriceAlerts = getPriceAlerts;
exports.getAlertsForMarketKey = getAlertsForMarketKey;
exports.deletePriceAlertById = deletePriceAlertById;
exports.togglePriceAlertById = togglePriceAlertById;
exports.formatAlertTreeLabel = formatAlertTreeLabel;
exports.formatAlertTreeDescription = formatAlertTreeDescription;
exports.formatAlertSummary = formatAlertSummary;
exports.evaluatePriceAlerts = evaluatePriceAlerts;
exports.createPriceAlert = createPriceAlert;
exports.managePriceAlerts = managePriceAlerts;
const vscode = __importStar(require("vscode"));
const providers_1 = require("./providers");
const stealthNotify_1 = require("./stealthNotify");
const ALERTS_STATE_KEY = 'kanpan.priceAlerts';
function getKanpanConfig() {
    return vscode.workspace.getConfiguration('kanpan');
}
function parseKey(marketKey) {
    const colon = marketKey.indexOf(':');
    const type = marketKey.slice(0, colon);
    const symbol = marketKey.slice(colon + 1);
    return {
        type,
        symbol: type === 'ashare' ? symbol.toLowerCase() : symbol.toUpperCase(),
    };
}
function displayLabel(symbol, name) {
    if (name) {
        return name;
    }
    const aliases = getKanpanConfig().get('aliases', {});
    return aliases[symbol] ?? (0, providers_1.defaultSymbolLabel)(symbol);
}
function isPctCondition(condition) {
    return condition === 'pct_up' || condition === 'pct_down' || condition === 'pct_both';
}
function sameLocalDay(a, b) {
    const da = new Date(a);
    const db = new Date(b);
    return (da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate());
}
function getPriceAlerts(context) {
    return context.globalState.get(ALERTS_STATE_KEY, []);
}
function getAlertsForMarketKey(context, marketKey) {
    return getPriceAlerts(context).filter((a) => a.marketKey === marketKey);
}
async function deletePriceAlertById(context, alertId) {
    const all = getPriceAlerts(context);
    const next = all.filter((a) => a.id !== alertId);
    if (next.length === all.length) {
        return false;
    }
    await savePriceAlerts(context, next);
    return true;
}
async function togglePriceAlertById(context, alertId) {
    const all = getPriceAlerts(context);
    let found = false;
    const next = all.map((a) => {
        if (a.id !== alertId) {
            return a;
        }
        found = true;
        return { ...a, enabled: !a.enabled };
    });
    if (!found) {
        return false;
    }
    await savePriceAlerts(context, next);
    return true;
}
async function savePriceAlerts(context, alerts) {
    await context.globalState.update(ALERTS_STATE_KEY, alerts);
}
function conditionLabel(condition) {
    switch (condition) {
        case 'above':
            return '高于';
        case 'below':
            return '低于';
        case 'crosses':
            return '触及';
        case 'pct_up':
            return '上涨达到';
        case 'pct_down':
            return '下跌达到';
        case 'pct_both':
            return '涨跌幅达到';
    }
}
function frequencyLabel(frequency) {
    switch (frequency) {
        case 'once':
            return '仅一次';
        case 'daily':
            return '每天一次';
        case 'always':
            return '每次触发';
    }
}
/** 侧边栏子行用的短描述 */
function formatAlertTreeLabel(alert) {
    if (isPctCondition(alert.condition)) {
        return `${conditionLabel(alert.condition)} ${alert.value}%`;
    }
    return `${conditionLabel(alert.condition)} ${(0, providers_1.formatPrice)(alert.value)}`;
}
function formatAlertTreeDescription(alert) {
    const parts = [frequencyLabel(alert.frequency)];
    if (alert.frequency === 'always') {
        parts.push(`冷却 ${getCooldownMinutes(alert)} 分`);
    }
    if (!alert.enabled) {
        parts.push('已停用');
    }
    return parts.join(' · ');
}
function formatAlertSummary(alert) {
    const { symbol } = parseKey(alert.marketKey);
    const label = displayLabel(symbol);
    if (isPctCondition(alert.condition)) {
        return `${label} ${conditionLabel(alert.condition)} ${alert.value}% · ${frequencyLabel(alert.frequency)}`;
    }
    return `${label} ${conditionLabel(alert.condition)} ${(0, providers_1.formatPrice)(alert.value)} · ${frequencyLabel(alert.frequency)}`;
}
function getCooldownMinutes(alert) {
    if (typeof alert.cooldownMinutes === 'number' && alert.cooldownMinutes >= 0) {
        return alert.cooldownMinutes;
    }
    return getKanpanConfig().get('alertCooldownMinutes', 10);
}
function canFire(alert, now) {
    if (!alert.enabled) {
        return false;
    }
    if (!alert.lastTriggeredAt) {
        return true;
    }
    if (alert.frequency === 'once') {
        return false;
    }
    if (alert.frequency === 'daily') {
        return !sameLocalDay(alert.lastTriggeredAt, now);
    }
    const cooldownMs = getCooldownMinutes(alert) * 60 * 1000;
    return now - alert.lastTriggeredAt >= cooldownMs;
}
function isConditionMet(alert, price) {
    switch (alert.condition) {
        case 'above':
            return price >= alert.value;
        case 'below':
            return price <= alert.value;
        case 'crosses': {
            const prev = alert.lastSeenPrice;
            if (prev === undefined || !Number.isFinite(prev)) {
                return false;
            }
            return (prev < alert.value && price >= alert.value) || (prev > alert.value && price <= alert.value);
        }
        case 'pct_up': {
            const base = alert.baselinePrice;
            if (!base || base <= 0) {
                return false;
            }
            return ((price - base) / base) * 100 >= alert.value;
        }
        case 'pct_down': {
            const base = alert.baselinePrice;
            if (!base || base <= 0) {
                return false;
            }
            return ((base - price) / base) * 100 >= alert.value;
        }
        case 'pct_both': {
            const base = alert.baselinePrice;
            if (!base || base <= 0) {
                return false;
            }
            return (Math.abs(price - base) / base) * 100 >= alert.value;
        }
    }
}
/** 对外弹出的隐蔽文案：只显示现价数字，避免一眼看出是行情提醒 */
function buildStealthNotifyText(quote) {
    return (0, providers_1.formatPrice)(quote.price);
}
/** 行情刷新后检查该标的的价格提醒 */
async function evaluatePriceAlerts(context, marketKey, quote) {
    const alerts = getPriceAlerts(context);
    const related = alerts.filter((a) => a.marketKey === marketKey);
    if (related.length === 0) {
        return;
    }
    const now = Date.now();
    let changed = false;
    const fired = [];
    for (const alert of related) {
        const price = quote.price;
        const met = isConditionMet(alert, price);
        const shouldNotify = met && canFire(alert, now);
        if (shouldNotify) {
            fired.push({ ...alert });
            alert.lastTriggeredAt = now;
            if (alert.frequency === 'once') {
                alert.enabled = false;
            }
            if (isPctCondition(alert.condition) && (alert.frequency === 'always' || alert.frequency === 'daily')) {
                // 触发后重置基准，便于下一次按幅度再提醒
                alert.baselinePrice = price;
            }
            changed = true;
        }
        if (alert.lastSeenPrice !== price) {
            alert.lastSeenPrice = price;
            changed = true;
        }
    }
    if (changed) {
        const byId = new Map(related.map((a) => [a.id, a]));
        const next = alerts.map((a) => byId.get(a.id) ?? a);
        await savePriceAlerts(context, next);
    }
    for (const _alert of fired) {
        // 只弹现价数字；优先系统通知，失败再回退编辑器角标
        void (0, stealthNotify_1.showStealthAlert)(buildStealthNotifyText(quote));
    }
}
async function pickCondition() {
    const picked = await vscode.window.showQuickPick([
        { label: '价格高于', description: '现价 ≥ 目标价', condition: 'above' },
        { label: '价格低于', description: '现价 ≤ 目标价', condition: 'below' },
        { label: '价格触及', description: '涨到或跌到该价都提醒', condition: 'crosses' },
        { label: '上涨达到', description: '相对设置时现价上涨 X%', condition: 'pct_up' },
        { label: '下跌达到', description: '相对设置时现价下跌 X%', condition: 'pct_down' },
        { label: '涨跌幅达到', description: '相对设置时现价双向变动 X%', condition: 'pct_both' },
    ], { placeHolder: '选择提醒条件' });
    return picked?.condition;
}
async function pickFrequency() {
    const picked = await vscode.window.showQuickPick([
        { label: '仅一次', description: '触发后自动关闭', frequency: 'once' },
        { label: '每天一次', description: '同一天最多提醒一次', frequency: 'daily' },
        {
            label: '每次触发',
            description: '条件满足就提醒（可设冷却，避免刷屏）',
            frequency: 'always',
        },
    ], { placeHolder: '选择提醒频率' });
    return picked?.frequency;
}
async function pickCooldownMinutes() {
    const defaultCooldown = getKanpanConfig().get('alertCooldownMinutes', 10);
    const input = await vscode.window.showInputBox({
        prompt: '冷却时间（分钟）。同一提醒在冷却期内不会重复弹出',
        placeHolder: String(defaultCooldown),
        value: String(defaultCooldown),
        validateInput: (value) => {
            const n = Number(value.trim());
            if (!Number.isFinite(n) || n < 0) {
                return '请输入 ≥ 0 的数字（0 表示不冷却）';
            }
            return undefined;
        },
    });
    if (input === undefined) {
        return undefined;
    }
    return Number(input.trim());
}
/** 为某个标的创建价格提醒 */
async function createPriceAlert(context, marketKey, currentPrice) {
    const { symbol } = parseKey(marketKey);
    const label = displayLabel(symbol);
    const condition = await pickCondition();
    if (!condition) {
        return;
    }
    let value;
    let baselinePrice;
    if (isPctCondition(condition)) {
        if (!currentPrice || currentPrice <= 0) {
            vscode.window.showWarningMessage(`暂无 ${label} 的有效现价，请等行情加载后再设涨跌幅提醒`);
            return;
        }
        const pctInput = await vscode.window.showInputBox({
            prompt: `输入涨跌幅阈值（%），基准现价 ${(0, providers_1.formatPrice)(currentPrice)}`,
            placeHolder: '5',
            validateInput: (v) => {
                const n = Number(v.trim());
                if (!Number.isFinite(n) || n <= 0) {
                    return '请输入大于 0 的百分比';
                }
                return undefined;
            },
        });
        if (!pctInput) {
            return;
        }
        value = Number(pctInput.trim());
        baselinePrice = currentPrice;
    }
    else {
        const priceInput = await vscode.window.showInputBox({
            prompt: `输入目标价格${currentPrice ? `（当前 ${(0, providers_1.formatPrice)(currentPrice)}）` : ''}`,
            placeHolder: currentPrice ? (0, providers_1.formatPrice)(currentPrice) : '70000',
            value: currentPrice ? String(currentPrice) : undefined,
            validateInput: (v) => {
                const n = Number(v.trim());
                if (!Number.isFinite(n) || n <= 0) {
                    return '请输入有效的目标价格';
                }
                return undefined;
            },
        });
        if (!priceInput) {
            return;
        }
        value = Number(priceInput.trim());
    }
    const frequency = await pickFrequency();
    if (!frequency) {
        return;
    }
    let cooldownMinutes;
    if (frequency === 'always') {
        cooldownMinutes = await pickCooldownMinutes();
        if (cooldownMinutes === undefined) {
            return;
        }
    }
    const alert = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        marketKey,
        condition,
        value,
        baselinePrice,
        frequency,
        cooldownMinutes,
        enabled: true,
        lastSeenPrice: currentPrice,
        createdAt: Date.now(),
    };
    const alerts = getPriceAlerts(context);
    alerts.push(alert);
    await savePriceAlerts(context, alerts);
    vscode.window.showInformationMessage(`已添加提醒: ${formatAlertSummary(alert)}`);
}
/** 管理某标的（或全部）提醒：删除 / 启停 */
async function managePriceAlerts(context, marketKey) {
    let alerts = getPriceAlerts(context);
    if (marketKey) {
        alerts = alerts.filter((a) => a.marketKey === marketKey);
    }
    if (alerts.length === 0) {
        vscode.window.showInformationMessage(marketKey ? '该标的暂无价格提醒' : '暂无价格提醒');
        return;
    }
    const picked = await vscode.window.showQuickPick(alerts.map((alert) => ({
        label: formatAlertSummary(alert),
        description: alert.enabled ? '启用中' : '已停用',
        detail: alert.frequency === 'always' ? `冷却 ${getCooldownMinutes(alert)} 分钟` : undefined,
        alert,
    })), { placeHolder: '选择要管理的提醒' });
    if (!picked) {
        return;
    }
    const action = await vscode.window.showQuickPick([
        { label: picked.alert.enabled ? '停用' : '启用', action: 'toggle' },
        { label: '删除', action: 'delete' },
    ], { placeHolder: formatAlertSummary(picked.alert) });
    if (!action) {
        return;
    }
    const all = getPriceAlerts(context);
    if (action.action === 'delete') {
        await savePriceAlerts(context, all.filter((a) => a.id !== picked.alert.id));
        vscode.window.showInformationMessage('已删除提醒');
        return;
    }
    const next = all.map((a) => a.id === picked.alert.id ? { ...a, enabled: !a.enabled } : a);
    await savePriceAlerts(context, next);
    vscode.window.showInformationMessage(picked.alert.enabled ? '已停用提醒' : '已启用提醒');
}
//# sourceMappingURL=priceAlerts.js.map