import * as vscode from 'vscode';
import { defaultSymbolLabel, formatPrice, QuoteData } from './providers';
import { showStealthAlert } from './stealthNotify';

const ALERTS_STATE_KEY = 'kanpan.priceAlerts';
const ALERTS_MUTED_KEY = 'kanpan.priceAlertsMuted';

export type AlertCondition =
  | 'above'
  | 'below'
  | 'crosses'
  | 'step'
  | 'pct_up'
  | 'pct_down'
  | 'pct_both';
export type AlertFrequency = 'once' | 'daily' | 'always';

export interface PriceAlert {
  id: string;
  marketKey: string;
  condition: AlertCondition;
  /** 绝对价格、涨跌幅百分比，或梯度步长 */
  value: number;
  /** 涨跌幅提醒的基准价（创建时的现价） */
  baselinePrice?: number;
  frequency: AlertFrequency;
  /** 「每次触发」冷却分钟数；未设则用全局配置 */
  cooldownMinutes?: number;
  enabled: boolean;
  lastTriggeredAt?: number;
  /** 用于「触及 / 梯度」判断穿越 */
  lastSeenPrice?: number;
  /** 梯度提醒：上次已处理的档位（floor(price/step)） */
  lastStepBucket?: number;
  createdAt: number;
}

/** 全局提醒开关（底部铃铛），默认开启 */
export function arePriceAlertsEnabled(context: vscode.ExtensionContext): boolean {
  return context.globalState.get<boolean>(ALERTS_MUTED_KEY, false) !== true;
}

/** 切换全局提醒开关，返回切换后是否开启 */
export async function togglePriceAlertsEnabled(
  context: vscode.ExtensionContext
): Promise<boolean> {
  const nextEnabled = !arePriceAlertsEnabled(context);
  await context.globalState.update(ALERTS_MUTED_KEY, !nextEnabled);
  return nextEnabled;
}

function getKanpanConfig() {
  return vscode.workspace.getConfiguration('kanpan');
}

function parseKey(marketKey: string): { type: string; symbol: string } {
  const colon = marketKey.indexOf(':');
  const type = marketKey.slice(0, colon);
  const symbol = marketKey.slice(colon + 1);
  return {
    type,
    symbol: type === 'ashare' ? symbol.toLowerCase() : symbol.toUpperCase(),
  };
}

function displayLabel(symbol: string, name?: string): string {
  if (name) {
    return name;
  }
  const aliases = getKanpanConfig().get<Record<string, string>>('aliases', {});
  return aliases[symbol] ?? defaultSymbolLabel(symbol);
}

function isPctCondition(condition: AlertCondition): boolean {
  return condition === 'pct_up' || condition === 'pct_down' || condition === 'pct_both';
}

function isStepCondition(condition: AlertCondition): boolean {
  return condition === 'step';
}

/** 价格所在的梯度档位，如 step=1000、价=67432 → 67 */
function stepBucket(price: number, step: number): number {
  return Math.floor(price / step);
}

function suggestStepSize(currentPrice?: number): string {
  if (!currentPrice || currentPrice <= 0) {
    return '1000';
  }
  if (currentPrice >= 10000) {
    return '1000';
  }
  if (currentPrice >= 1000) {
    return '100';
  }
  if (currentPrice >= 100) {
    return '10';
  }
  if (currentPrice >= 1) {
    return '1';
  }
  return '0.01';
}

function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function getPriceAlerts(context: vscode.ExtensionContext): PriceAlert[] {
  return context.globalState.get<PriceAlert[]>(ALERTS_STATE_KEY, []);
}

export function getAlertsForMarketKey(
  context: vscode.ExtensionContext,
  marketKey: string
): PriceAlert[] {
  return getPriceAlerts(context).filter((a) => a.marketKey === marketKey);
}

export async function deletePriceAlertById(
  context: vscode.ExtensionContext,
  alertId: string
): Promise<boolean> {
  const all = getPriceAlerts(context);
  const next = all.filter((a) => a.id !== alertId);
  if (next.length === all.length) {
    return false;
  }
  await savePriceAlerts(context, next);
  return true;
}

export async function togglePriceAlertById(
  context: vscode.ExtensionContext,
  alertId: string
): Promise<boolean> {
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

async function savePriceAlerts(
  context: vscode.ExtensionContext,
  alerts: PriceAlert[]
): Promise<void> {
  await context.globalState.update(ALERTS_STATE_KEY, alerts);
}

function conditionLabel(condition: AlertCondition): string {
  switch (condition) {
    case 'above':
      return '高于';
    case 'below':
      return '低于';
    case 'crosses':
      return '触及';
    case 'step':
      return '梯度';
    case 'pct_up':
      return '上涨达到';
    case 'pct_down':
      return '下跌达到';
    case 'pct_both':
      return '涨跌幅达到';
  }
}

function frequencyLabel(frequency: AlertFrequency): string {
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
export function formatAlertTreeLabel(alert: PriceAlert): string {
  if (isPctCondition(alert.condition)) {
    return `${conditionLabel(alert.condition)} ${alert.value}%`;
  }
  if (isStepCondition(alert.condition)) {
    return `每 ${formatPrice(alert.value)} 一档`;
  }
  return `${conditionLabel(alert.condition)} ${formatPrice(alert.value)}`;
}

export function formatAlertTreeDescription(alert: PriceAlert): string {
  const parts = [frequencyLabel(alert.frequency)];
  if (alert.frequency === 'always') {
    parts.push(`冷却 ${getCooldownMinutes(alert)} 分`);
  }
  if (!alert.enabled) {
    parts.push('已停用');
  }
  return parts.join(' · ');
}

export function formatAlertSummary(alert: PriceAlert): string {
  const { symbol } = parseKey(alert.marketKey);
  const label = displayLabel(symbol);
  if (isPctCondition(alert.condition)) {
    return `${label} ${conditionLabel(alert.condition)} ${alert.value}% · ${frequencyLabel(alert.frequency)}`;
  }
  if (isStepCondition(alert.condition)) {
    return `${label} 每 ${formatPrice(alert.value)} 关键点位 · ${frequencyLabel(alert.frequency)}`;
  }
  return `${label} ${conditionLabel(alert.condition)} ${formatPrice(alert.value)} · ${frequencyLabel(alert.frequency)}`;
}

function getCooldownMinutes(alert: PriceAlert): number {
  if (typeof alert.cooldownMinutes === 'number' && alert.cooldownMinutes >= 0) {
    return alert.cooldownMinutes;
  }
  return getKanpanConfig().get<number>('alertCooldownMinutes', 10);
}

function canFire(alert: PriceAlert, now: number): boolean {
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

function isConditionMet(alert: PriceAlert, price: number): boolean {
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
    case 'step': {
      const step = alert.value;
      if (!Number.isFinite(step) || step <= 0) {
        return false;
      }
      const currBucket = stepBucket(price, step);
      // 优先用专用档位字段；没有则退回用上次价格推算
      if (typeof alert.lastStepBucket === 'number' && Number.isFinite(alert.lastStepBucket)) {
        return alert.lastStepBucket !== currBucket;
      }
      const prev = alert.lastSeenPrice;
      if (prev === undefined || !Number.isFinite(prev)) {
        return false;
      }
      return stepBucket(prev, step) !== currBucket;
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

/** 行情刷新后检查该标的的价格提醒 */
export async function evaluatePriceAlerts(
  context: vscode.ExtensionContext,
  marketKey: string,
  quote: QuoteData
): Promise<void> {
  const alerts = getPriceAlerts(context);
  const related = alerts.filter((a) => a.marketKey === marketKey);
  if (related.length === 0) {
    return;
  }

  const alertsEnabled = arePriceAlertsEnabled(context);
  const now = Date.now();
  let changed = false;
  const fired: PriceAlert[] = [];

  for (const alert of related) {
    const price = quote.price;
    const prevPrice = alert.lastSeenPrice;

    // 梯度：首次见到价格时只初始化档位，不提醒（避免一创建就弹）
    if (isStepCondition(alert.condition) && typeof alert.lastStepBucket !== 'number') {
      if (Number.isFinite(price) && alert.value > 0) {
        alert.lastStepBucket = stepBucket(price, alert.value);
        alert.lastSeenPrice = price;
        changed = true;
      }
      continue;
    }

    const met = isConditionMet(alert, price);
    const shouldNotify = alertsEnabled && met && canFire(alert, now);

    if (shouldNotify) {
      fired.push({ ...alert });
      alert.lastTriggeredAt = now;
      if (alert.frequency === 'once') {
        alert.enabled = false;
      }
      if (isPctCondition(alert.condition) && (alert.frequency === 'always' || alert.frequency === 'daily')) {
        alert.baselinePrice = price;
      }
      if (isStepCondition(alert.condition) && alert.value > 0) {
        alert.lastStepBucket = stepBucket(price, alert.value);
      }
      alert.lastSeenPrice = price;
      changed = true;
      continue;
    }

    // 全局关闭提醒时仍推进锚点，避免重新打开后把关闭期间跨过的档位一次性补弹
    if (met && !alertsEnabled) {
      alert.lastSeenPrice = price;
      if (isStepCondition(alert.condition) && alert.value > 0) {
        alert.lastStepBucket = stepBucket(price, alert.value);
      }
      changed = true;
      continue;
    }

    // 条件已满足但被冷却/频率拦住：不要推进锚点，否则会漏报关键点位
    if (met && !shouldNotify) {
      continue;
    }

    if (prevPrice !== price) {
      alert.lastSeenPrice = price;
      if (isStepCondition(alert.condition) && alert.value > 0) {
        alert.lastStepBucket = stepBucket(price, alert.value);
      }
      changed = true;
    }
  }

  if (changed) {
    const byId = new Map(related.map((a) => [a.id, a]));
    const next = alerts.map((a) => byId.get(a.id) ?? a);
    await savePriceAlerts(context, next);
  }

  for (const _alert of fired) {
    // 伪装成 Android Studio 构建通知；涨绿底、跌红底
    void showStealthAlert(quote.price, quote.changePercent >= 0);
  }
}

async function pickCondition(): Promise<AlertCondition | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '价格高于', description: '现价 ≥ 目标价', condition: 'above' as const },
      { label: '价格低于', description: '现价 ≤ 目标价', condition: 'below' as const },
      { label: '价格触及', description: '涨到或跌到该价都提醒', condition: 'crosses' as const },
      {
        label: '梯度关键点',
        description: '每涨跌一个步长提醒，如每 1000 → 67000、68000…',
        condition: 'step' as const,
      },
      { label: '上涨达到', description: '相对设置时现价上涨 X%', condition: 'pct_up' as const },
      { label: '下跌达到', description: '相对设置时现价下跌 X%', condition: 'pct_down' as const },
      { label: '涨跌幅达到', description: '相对设置时现价双向变动 X%', condition: 'pct_both' as const },
    ],
    { placeHolder: '选择提醒条件' }
  );
  return picked?.condition;
}

async function pickFrequency(preferAlways = false): Promise<AlertFrequency | undefined> {
  const items = [
    { label: '仅一次', description: '触发后自动关闭', frequency: 'once' as const },
    { label: '每天一次', description: '同一天最多提醒一次', frequency: 'daily' as const },
    {
      label: '每次触发',
      description: preferAlways
        ? '推荐：每跨一档关键点都提醒（可设冷却）'
        : '条件满足就提醒（可设冷却，避免刷屏）',
      frequency: 'always' as const,
    },
  ];
  const picked = await vscode.window.showQuickPick(
    preferAlways ? [items[2], items[0], items[1]] : items,
    { placeHolder: preferAlways ? '梯度提醒建议选「每次触发」' : '选择提醒频率' }
  );
  return picked?.frequency;
}

async function pickCooldownMinutes(defaultMinutes?: number): Promise<number | undefined> {
  const fallback = getKanpanConfig().get<number>('alertCooldownMinutes', 10);
  const initial = defaultMinutes ?? fallback;
  const input = await vscode.window.showInputBox({
    prompt: '冷却时间（分钟）。同一提醒在冷却期内不会重复弹出',
    placeHolder: String(initial),
    value: String(initial),
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
export async function createPriceAlert(
  context: vscode.ExtensionContext,
  marketKey: string,
  currentPrice?: number
): Promise<void> {
  const { symbol } = parseKey(marketKey);
  const label = displayLabel(symbol);

  const condition = await pickCondition();
  if (!condition) {
    return;
  }

  let value: number;
  let baselinePrice: number | undefined;

  if (isPctCondition(condition)) {
    if (!currentPrice || currentPrice <= 0) {
      vscode.window.showWarningMessage(`暂无 ${label} 的有效现价，请等行情加载后再设涨跌幅提醒`);
      return;
    }
    const pctInput = await vscode.window.showInputBox({
      prompt: `输入涨跌幅阈值（%），基准现价 ${formatPrice(currentPrice)}`,
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
  } else if (isStepCondition(condition)) {
    const suggested = suggestStepSize(currentPrice);
    const exampleLevel =
      currentPrice && currentPrice > 0
        ? formatPrice(Math.floor(currentPrice / Number(suggested)) * Number(suggested))
        : '67000';
    const stepInput = await vscode.window.showInputBox({
      prompt: `输入梯度步长（例如 ${suggested}：每到 ${exampleLevel}、下一档…就提醒）`,
      placeHolder: suggested,
      value: suggested,
      validateInput: (v) => {
        const n = Number(v.trim());
        if (!Number.isFinite(n) || n <= 0) {
          return '请输入大于 0 的步长';
        }
        return undefined;
      },
    });
    if (!stepInput) {
      return;
    }
    value = Number(stepInput.trim());
  } else {
    const priceInput = await vscode.window.showInputBox({
      prompt: `输入目标价格${currentPrice ? `（当前 ${formatPrice(currentPrice)}）` : ''}`,
      placeHolder: currentPrice ? formatPrice(currentPrice) : '70000',
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

  const frequency = await pickFrequency(isStepCondition(condition));
  if (!frequency) {
    return;
  }

  let cooldownMinutes: number | undefined;
  if (frequency === 'always') {
    // 梯度提醒默认少冷却，避免连涨时漏档
    cooldownMinutes = await pickCooldownMinutes(isStepCondition(condition) ? 0 : undefined);
    if (cooldownMinutes === undefined) {
      return;
    }
  }

  const alert: PriceAlert = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    marketKey,
    condition,
    value,
    baselinePrice,
    frequency,
    cooldownMinutes,
    enabled: true,
    lastSeenPrice: currentPrice,
    lastStepBucket:
      isStepCondition(condition) && currentPrice && currentPrice > 0 && value > 0
        ? stepBucket(currentPrice, value)
        : undefined,
    createdAt: Date.now(),
  };

  const alerts = getPriceAlerts(context);
  alerts.push(alert);
  await savePriceAlerts(context, alerts);
  vscode.window.showInformationMessage(`已添加提醒: ${formatAlertSummary(alert)}`);
}

/** 管理某标的（或全部）提醒：删除 / 启停 */
export async function managePriceAlerts(
  context: vscode.ExtensionContext,
  marketKey?: string
): Promise<void> {
  let alerts = getPriceAlerts(context);
  if (marketKey) {
    alerts = alerts.filter((a) => a.marketKey === marketKey);
  }
  if (alerts.length === 0) {
    vscode.window.showInformationMessage(marketKey ? '该标的暂无价格提醒' : '暂无价格提醒');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    alerts.map((alert) => ({
      label: formatAlertSummary(alert),
      description: alert.enabled ? '启用中' : '已停用',
      detail: alert.frequency === 'always' ? `冷却 ${getCooldownMinutes(alert)} 分钟` : undefined,
      alert,
    })),
    { placeHolder: '选择要管理的提醒' }
  );
  if (!picked) {
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: picked.alert.enabled ? '停用' : '启用', action: 'toggle' as const },
      { label: '删除', action: 'delete' as const },
    ],
    { placeHolder: formatAlertSummary(picked.alert) }
  );
  if (!action) {
    return;
  }

  const all = getPriceAlerts(context);
  if (action.action === 'delete') {
    await savePriceAlerts(
      context,
      all.filter((a) => a.id !== picked.alert.id)
    );
    vscode.window.showInformationMessage('已删除提醒');
    return;
  }

  const next = all.map((a) =>
    a.id === picked.alert.id ? { ...a, enabled: !a.enabled } : a
  );
  await savePriceAlerts(context, next);
  vscode.window.showInformationMessage(picked.alert.enabled ? '已停用提醒' : '已启用提醒');
}
