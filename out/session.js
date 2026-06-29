"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsMarketSession = getUsMarketSession;
exports.sessionLabel = sessionLabel;
function getUsMarketSession(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
        weekday: 'short',
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const minutes = hour * 60 + minute;
    if (weekday === 'Sat' || weekday === 'Sun') {
        return 'closed';
    }
    if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
        return 'pre';
    }
    if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
        return 'regular';
    }
    if (minutes >= 16 * 60 && minutes < 20 * 60) {
        return 'after';
    }
    return 'closed';
}
function sessionLabel(session) {
    switch (session) {
        case 'pre':
            return '盘前';
        case 'regular':
            return '盘中';
        case 'after':
            return '盘后';
        case 'closed':
            return '休市';
        default:
            return '未知';
    }
}
//# sourceMappingURL=session.js.map