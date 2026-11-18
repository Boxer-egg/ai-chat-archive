/**
 * 账号提示提取、切换检测（技术方案 §8.4）。
 * 缓存 5 秒；切换时由 bootstrap 执行 flush → 重建。
 */
import type { AccountHintInput, PlatformAdapter } from '../core/types';
import { accountKeyFor, maskLabel } from '../core/account';
import { TIMING } from '../shared/constants';

export interface ResolvedAccount {
  key: string;
  label: string;
}

let cache: { key: string; label: string; at: number } | null = null;

export async function resolveAccount(
  adapter: PlatformAdapter,
  ctx: Parameters<PlatformAdapter['getAccountHint']>[0],
): Promise<ResolvedAccount> {
  const now = Date.now();
  if (cache && now - cache.at < TIMING.ACCOUNT_CACHE_MS) {
    return { key: cache.key, label: cache.label };
  }
  let hint: AccountHintInput | null = null;
  try {
    hint = adapter.getAccountHint(ctx);
  } catch {
    hint = null;
  }
  const key = hint ? await accountKeyFor(adapter.id, hint.rawId) : 'default';
  const label = hint ? maskLabel(hint) : '默认账号';
  cache = { key, label, at: now };
  return { key, label };
}

/** 供测试与 SPA 切换时清空缓存 */
export function resetAccountCache(): void {
  cache = null;
}
