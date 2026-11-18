/**
 * 文本规范化 + 内容指纹（技术方案 §6.2）。
 * 指纹只用于"没有平台 ID"的兜底，不作为唯一真相。
 */
import type { Role } from '../types';

export function normalize(text: string): string {
  return text
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '') // 零宽字符
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '') // 行尾空白
    .replace(/\n{3,}/g, '\n\n') // 连续空行
    .trim();
}

/** SHA-256 → 前 8 字节 hex（contentHash / fingerprint 用） */
export async function sha256Hex(data: string, bytes = 8): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return [...new Uint8Array(buf).slice(0, bytes)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 内容哈希：规范化文本的 SHA-256（短截） */
export async function contentHash(text: string): Promise<string> {
  return sha256Hex(`h\u0000${normalize(text)}`);
}

/** 指纹：角色 + 规范化文本（短截）。同角色同文本 → 同指纹 */
export async function fingerprint(role: Role, text: string): Promise<string> {
  return sha256Hex(`${role}\u0000${normalize(text)}`);
}

/**
 * 去重身份键（技术方案 §6.1 / §6.3）：
 * 1. 平台消息 ID + 角色：`p:<id>:<role>`（同一 turn-key 可能同时属于用户与助手两条消息，如 Claude）
 * 2. 兜底：`f:<fingerprint>#<occurrence>`（occurrence 是库内同指纹消息按 order 的序号，从 0 开始）
 */
export function msgKeyFor(
  platformMessageId: string | undefined,
  fp: string,
  occurrence: number,
  role?: Role,
): string {
  if (platformMessageId) return `p:${platformMessageId}:${role ?? 'x'}`;
  return `f:${fp}#${occurrence}`;
}
