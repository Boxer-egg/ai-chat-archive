/**
 * 账号键生成与展示名脱敏（技术方案 §8.4）。
 * 稳定哈希（不加盐）：换机导入备份后同一账号仍归同一个桶。
 */
import type { AccountHintInput } from './types';
import { sha256Hex } from './merge/fingerprint';

/** accountKey = sha256('ai-archive\0' + platform + '\0' + rawId) 取前 12 位 hex */
export async function accountKeyFor(platform: string, rawId: string): Promise<string> {
  return sha256Hex(`ai-archive\u0000${platform}\u0000${rawId}`, 12);
}

/** 展示名脱敏：邮箱 / 手机 / 昵称 / 工作区 */
export function maskLabel(hint: AccountHintInput): string {
  const label = hint.label.trim();
  if (hint.source === 'workspace') return label || '工作区';
  if (hint.source === 'email' && label.includes('@')) {
    const [name, domain] = label.split('@');
    return `${name.slice(0, 1)}***@${domain}`;
  }
  if (hint.source === 'dom-id' && /^\d{6,}$/.test(label)) {
    return `${label.slice(0, 3)}****${label.slice(-4)}`;
  }
  // 昵称：保留首尾各 1 字
  if (label.length <= 2) return label;
  return `${label[0]}${'*'.repeat(Math.min(label.length - 2, 6))}${label[label.length - 1]}`;
}
