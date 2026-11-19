/** 内容脚本 ↔ SW ↔ UI 的消息协议（类型安全，可重试，幂等） */
import type { AccountSource, ConversationRef, MergeResult, RawMessage } from './types';

export interface SnapshotPayload {
  accountKey: string;
  accountLabel: string;
  accountSource: AccountSource;
  conversation: ConversationRef;
  conversationUrl: string;
  title: string | null;
  raws: RawMessage[];
  adapterId: string;
  adapterVersion: string;
  platformMessageCount: number;
}

// ---------- 设置 ----------

export interface Settings {
  autoSave: boolean;
  /** 暂停采集的域名列表 */
  disabledHosts: string[];
  debugLogging: boolean;
  /** Markdown 导出时图片的处理方式：link=保留链接（默认），omit=不导出图片 */
  imageExportMode: 'link' | 'omit';
}

export const DEFAULT_SETTINGS: Settings = {
  autoSave: true,
  disabledHosts: [],
  debugLogging: false,
  imageExportMode: 'link',
};

// ---------- 内容脚本状态 ----------

export interface ContentStatus {
  hasConversation: boolean;
  adapterId: string | null;
  adapterVersion: string | null;
  conversationId: string | null;
  accountLabel: string | null;
  title: string | null;
  platformMessageCount: number;
  lastSync: MergeResult | null;
  health: 'ok' | 'degraded' | 'broken' | 'unknown';
}

// ---------- 搜索 ----------

export interface SearchHitMessage {
  id: string;
  role: string;
  order: number;
  snippet: string;
}

export interface SearchHitConversation {
  conversationId: string;
  title: string;
  platform: string;
  accountLabel: string;
  url: string;
  updatedAt: number;
  messages: SearchHitMessage[];
}

export interface SearchRequest {
  query: string;
  platform?: string;
  accountKey?: string;
  limit?: number;
}

// ---------- 导入 ----------

export interface ImportSummary {
  conversations: number;
  messages: number;
}

export const PROTOCOL = {
  UPSERT_SNAPSHOT: 'UPSERT_SNAPSHOT',
  GET_CONTENT_STATUS: 'GET_CONTENT_STATUS',
  FORCE_SYNC: 'FORCE_SYNC',
  GET_SETTINGS: 'GET_SETTINGS',
  SET_SETTINGS: 'SET_SETTINGS',
  LIST_ACCOUNTS: 'LIST_ACCOUNTS',
  LIST_CONVERSATIONS: 'LIST_CONVERSATIONS',
  GET_MESSAGES: 'GET_MESSAGES',
  SEARCH_MESSAGES: 'SEARCH_MESSAGES',
  DELETE_CONVERSATION: 'DELETE_CONVERSATION',
  CLEAR_ALL: 'CLEAR_ALL',
  EXPORT_JSON: 'EXPORT_JSON',
  EXPORT_MARKDOWN: 'EXPORT_MARKDOWN',
  IMPORT_PREVIEW: 'IMPORT_PREVIEW',
  IMPORT_APPLY: 'IMPORT_APPLY',
} as const;

export type ProtocolMessage =
  | { type: typeof PROTOCOL.UPSERT_SNAPSHOT; payload: SnapshotPayload }
  | { type: typeof PROTOCOL.GET_CONTENT_STATUS }
  | { type: typeof PROTOCOL.FORCE_SYNC }
  | { type: typeof PROTOCOL.SET_SETTINGS; patch: Partial<Settings> }
  | { type: typeof PROTOCOL.GET_SETTINGS }
  | { type: typeof PROTOCOL.LIST_ACCOUNTS }
  | { type: typeof PROTOCOL.LIST_CONVERSATIONS; filter?: { platform?: string; accountKey?: string } }
  | { type: typeof PROTOCOL.GET_MESSAGES; conversationId: string }
  | { type: typeof PROTOCOL.SEARCH_MESSAGES; request: SearchRequest }
  | { type: typeof PROTOCOL.DELETE_CONVERSATION; conversationId: string }
  | { type: typeof PROTOCOL.CLEAR_ALL }
  | { type: typeof PROTOCOL.EXPORT_JSON; conversationId?: string }
  | { type: typeof PROTOCOL.EXPORT_MARKDOWN; conversationId?: string }
  | { type: typeof PROTOCOL.IMPORT_PREVIEW; backupJson: string }
  | { type: typeof PROTOCOL.IMPORT_APPLY; backupJson: string };
