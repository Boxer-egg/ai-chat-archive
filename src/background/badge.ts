/** 角标状态机（技术方案 §11.1）。按 tab 维护。 */

export type BadgeState =
  | 'unsupported'
  | 'paused'
  | 'active'
  | 'syncing'
  | 'degraded'
  | 'broken'
  | 'error';

const COLORS: Record<BadgeState, string> = {
  unsupported: '#9ca3af',
  paused: '#9ca3af',
  active: '#22c55e',
  syncing: '#3b82f6',
  degraded: '#eab308',
  broken: '#f97316',
  error: '#ef4444',
};

export function badgeText(state: BadgeState, count: number | null): string {
  switch (state) {
    case 'active':
      return count === null ? '' : count > 99 ? '99+' : String(count);
    case 'syncing':
      return '…';
    case 'degraded':
    case 'broken':
    case 'error':
      return '!';
    default:
      return '–';
  }
}

/** chrome.action 封装（浏览器侧）；纯函数部分可单测 */
export async function setBadge(tabId: number, state: BadgeState, count: number | null = null): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: COLORS[state] });
  await chrome.action.setBadgeText({ tabId, text: badgeText(state, count) });
}
