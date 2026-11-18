/** store/index 定义的单一事实来源（技术方案 §5.2） */

export const DB_NAME = 'ai-chat-archive';
export const DB_VERSION = 1;

export const STORES = {
  conversations: 'conversations',
  accounts: 'accounts',
  messages: 'messages',
  settings: 'settings',
  events: 'events',
  meta: 'meta',
  syncState: 'syncState',
} as const;

export interface StoreDef {
  keyPath: string | null;
  autoIncrement?: boolean;
  indexes: Array<{ name: string; keyPath: string | string[]; unique?: boolean }>;
}

export const SCHEMA: Record<string, StoreDef> = {
  conversations: {
    keyPath: 'id',
    indexes: [
      { name: 'by_platform', keyPath: 'platform' },
      { name: 'by_account', keyPath: 'accountKey' },
      { name: 'by_updatedAt', keyPath: 'updatedAt' },
      { name: 'by_platform_account_pcid', keyPath: ['platform', 'accountKey', 'platformConversationId'], unique: true },
      { name: 'by_url', keyPath: 'url' },
    ],
  },
  accounts: {
    keyPath: 'id',
    indexes: [
      { name: 'by_platform', keyPath: 'platform' },
      { name: 'by_lastSeenAt', keyPath: 'lastSeenAt' },
    ],
  },
  messages: {
    keyPath: 'id',
    indexes: [
      { name: 'by_conv_order', keyPath: ['conversationId', 'order'] },
      { name: 'by_conv_key', keyPath: ['conversationId', 'msgKey'], unique: true },
      { name: 'by_conv_hash', keyPath: ['conversationId', 'contentHash'] },
      { name: 'by_conv_status', keyPath: ['conversationId', 'status'] },
      { name: 'by_savedAt', keyPath: 'savedAt' },
    ],
  },
  settings: {
    keyPath: 'key',
    indexes: [],
  },
  events: {
    keyPath: 'id',
    autoIncrement: true,
    indexes: [{ name: 'by_ts', keyPath: 'ts' }],
  },
  meta: {
    keyPath: 'key',
    indexes: [],
  },
  syncState: {
    keyPath: 'conversationId',
    indexes: [],
  },
};

// 兜底：上面每条定义都必须有 keyPath（迁移用它建 store）
