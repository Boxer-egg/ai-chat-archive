/**
 * 核心类型：会话 / 消息 / 账号线索 / 协议。
 * 这里不依赖 chrome.*，可在 Node 里直接单测。
 */

export type PlatformId = 'deepseek' | 'kimi' | 'claude' | 'chatgpt' | 'grok';

/** 采集只产出 user / assistant；system / tool 预留给导入的第三方备份 */
export type Role = 'user' | 'assistant' | 'system' | 'tool';
export type CapturedRole = Extract<Role, 'user' | 'assistant'>;

export interface AdapterContext {
  url: URL;
  document: Document;
  now: number;
}

/**
 * 批量解析帧：extractor 一次性取好消息节点后传给 parseMessage，
 * 避免每个节点重复全量扫描 DOM（适配器直接两参调用时走内部 fallback）。
 */
export interface ParseFrame {
  /** 本次扫描的消息节点（DOM 顺序） */
  nodes: Element[];
  /** node 在 nodes 中的下标 */
  index: number;
}

export interface ConversationRef {
  platformConversationId: string;
  /** 记录来源，排障用 */
  source: 'url' | 'dom' | 'generated';
}

/** 账号线索：只从页面可见信息里取，绝不读 Cookie / localStorage / 登录令牌 */
export interface AccountHintInput {
  /** 平台内稳定的原始标识（用户 ID、邮箱、workspace ID）。只在本机内存里短暂存在 */
  rawId: string;
  /** 给人看的展示名，核心层负责脱敏后再落库 */
  label: string;
  source: 'dom-id' | 'email' | 'workspace' | 'avatar';
}

export interface RawMessage {
  /** 平台自己的消息 ID（有就一定要给，这是去重第一优先级） */
  platformMessageId?: string;
  role: Role;
  /** 纯文本，必须保留换行与代码缩进 */
  text: string;
  /** 已消毒的 HTML（可选，用于保留代码块/列表格式） */
  html?: string;
  /** 本次扫描中的 DOM 顺序，仅用于对齐与排序，不做身份标识 */
  domIndex: number;
  streaming?: boolean;
  /** 平台提供的时间戳（毫秒），没有就留空 */
  timestamp?: number;
  /** 生成该消息的模型标识（平台 DOM 暴露时尽力提取，缺省 undefined） */
  model?: string;
  /** 只存 URL 与文件名，不下载本体 */
  attachments?: Array<{ type: 'image' | 'file' | 'link'; name?: string; url?: string }>;
}

export interface AdapterDiagnosis {
  status: 'ok' | 'degraded' | 'broken';
  messageCount: number;
  misses: string[];
  notes?: string;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly version: string;
  readonly displayName: string;
  /** 仅用于开发期校验与 manifest 生成，运行时以 manifest 为准 */
  readonly hosts: string[];

  match(url: URL): boolean;
  getConversation(ctx: AdapterContext): ConversationRef | null;
  getAccountHint(ctx: AdapterContext): AccountHintInput | null;
  getTitle(ctx: AdapterContext): string | null;
  getMessageRoot(ctx: AdapterContext): Element | null;
  getMessageNodes(ctx: AdapterContext): Element[];
  parseMessage(node: Element, ctx: AdapterContext, frame?: ParseFrame): RawMessage | null;
  isStreaming(ctx: AdapterContext): boolean;
  getScrollContainer(ctx: AdapterContext): HTMLElement | null;

  /**
   * 采集前准备（可选）：如点击展开懒渲染的折叠面板（Kimi 思考步骤）。
   * 内容异步渲染，当次快照只有标题，下一次 MutationObserver 触发的
   * 快照即可提取到内容。已展开的应跳过，避免触发回环。
   */
  prepareForSnapshot?(ctx: AdapterContext): void;
  getLoadMoreTrigger?(ctx: AdapterContext): Element | null;
  diagnose(ctx: AdapterContext): AdapterDiagnosis;
}

// ---------- 落库记录 ----------

export interface Conversation {
  /** `${platform}:${accountKey}:${platformConversationId}` */
  id: string;
  platform: PlatformId;
  accountKey: string;
  accountLabel: string;
  platformConversationId: string;
  title: string;
  url: string;
  createdAt: number;
  /** 最后一条消息的时间（展示排序用） */
  updatedAt: number;
  lastSyncedAt: number;
  /** 完整消息数（不含 draft） */
  messageCount: number;
  adapterVersion: string;
  source: 'url' | 'dom' | 'generated';
  urlHistory: string[];
}

export type AccountSource = 'dom-id' | 'email' | 'workspace' | 'avatar' | 'default';

export interface Account {
  /** `${platform}:${accountKey}` */
  id: string;
  platform: PlatformId;
  accountKey: string;
  label: string;
  source: AccountSource;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface Message {
  /** `${conversationId}#${msgKey}`（确定性，天然幂等） */
  id: string;
  conversationId: string;
  /** 去重身份键，见 merge/fingerprint.ts */
  msgKey: string;
  platformMessageId?: string;
  role: Role;
  contentText: string;
  contentHtml?: string;
  /** 展示顺序，浮点，见 merge/order.ts */
  order: number;
  timestamp?: number;
  /** 模型标识（采集时平台 DOM 可见才填充），导出可带 */
  model?: string;
  fingerprint: string;
  contentHash: string;
  status: 'draft' | 'complete';
  truncated?: boolean;
  domIndex?: number;
  savedAt: number;
  updatedAt: number;
  adapterVersion: string;
}

export interface SyncState {
  conversationId: string;
  lastAttemptAt: number;
  lastResult: 'ok' | 'partial' | 'error';
  lastError?: string;
  /** 最近一次成功写入的指纹集合哈希，用于快速判断"没有变化" */
  snapshotHash: string;
}

export interface ArchiveEvent {
  id?: number;
  ts: number;
  kind:
    | 'adapter-health'
    | 'account-switch'
    | 'account-unknown'
    | 'merge-conflict'
    | 'error'
    | 'info';
  platform?: PlatformId;
  conversationId?: string;
  message?: string;
  data?: Record<string, unknown>;
}

// ---------- 合并结果 ----------

export interface MergeResult {
  inserted: number;
  updated: number;
  touched: number;
  skipped: number;
  messageCount: number;
  conversationTitleChanged: boolean;
  orderRenumbered: boolean;
}
