/**
 * JSON 备份（恢复用，非默认导出）与导入（技术方案 §13.1/§13.3）。
 * 导入复用 merge 通道：保证去重规则与采集一致。
 */
import type { Account, Conversation, Message } from '../types';

export const BACKUP_FORMAT = 'ai-chat-archive';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  stats: { conversations: number; messages: number };
  accounts: Account[];
  conversations: Conversation[];
  messages: Message[];
}

export function buildBackup(input: {
  schemaVersion: number;
  appVersion: string;
  accounts: Account[];
  conversations: Conversation[];
  messages: Message[];
}): BackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: input.schemaVersion,
    appVersion: input.appVersion,
    exportedAt: new Date().toISOString(),
    stats: {
      conversations: input.conversations.length,
      messages: input.messages.length,
    },
    accounts: input.accounts,
    conversations: input.conversations,
    messages: input.messages,
  };
}

export class ImportError extends Error {}

/** 校验并解析备份文件；不通过则抛 ImportError（拒绝导入，不破坏现有数据） */
export function parseBackup(json: unknown, currentSchemaVersion: number): BackupFile {
  if (typeof json !== 'object' || json === null) throw new ImportError('备份文件无法识别');
  const b = json as Partial<BackupFile>;
  if (b.format !== BACKUP_FORMAT) throw new ImportError('备份文件格式不对');
  if (typeof b.schemaVersion !== 'number') throw new ImportError('缺少 schemaVersion');
  if (b.schemaVersion > currentSchemaVersion) {
    throw new ImportError('备份来自更新版本的扩展，请升级后再导入');
  }
  if (!Array.isArray(b.conversations) || !Array.isArray(b.messages)) {
    throw new ImportError('备份内容不完整');
  }
  return b as BackupFile;
}

/** 导出前体积估算（超过阈值提示分平台导出） */
export function estimateBackupBytes(b: BackupFile): number {
  let n = 0;
  for (const m of b.messages) n += m.contentText?.length ?? 0;
  return n * 2 + (b.conversations.length + b.accounts.length) * 500;
}

export const BACKUP_WARN_BYTES = 50 * 1024 * 1024;
