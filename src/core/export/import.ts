/** 导入：把备份文件按会话分组，逐会话走 merge 通道（与采集同一条去重路径） */
import type { Message } from '../types';
import { mergeSnapshot, type MergeOutput } from '../merge/merge-snapshot';
import type { BackupFile } from './json';

export interface ImportPlanItem {
  conversationId: string;
  messages: number;
}

/** 预检（dry-run）：统计每个会话将处理多少条消息，给用户看报告 */
export function planImport(backup: BackupFile): ImportPlanItem[] {
  const byConv = new Map<string, number>();
  for (const m of backup.messages) {
    byConv.set(m.conversationId, (byConv.get(m.conversationId) ?? 0) + 1);
  }
  return [...byConv.entries()].map(([conversationId, messages]) => ({ conversationId, messages }));
}

/**
 * 合并导入数据：对每条会话的备份消息跑 mergeSnapshot（相对空库），
 * 调用方负责把结果与现有数据再次合并或按 msgKey 冲突规则落库。
 */
export async function mergeBackupConversation(
  conversationId: string,
  messages: Message[],
  now: number,
): Promise<MergeOutput> {
  const raws = messages
    .sort((a, b) => a.order - b.order)
    .map((m, i) => ({
      role: m.role,
      text: m.contentText,
      html: m.contentHtml,
      domIndex: i,
      platformMessageId: m.platformMessageId,
      timestamp: m.timestamp,
    }));
  return mergeSnapshot({ conversationId, existing: [], raws, now, adapterVersion: 'import' });
}
