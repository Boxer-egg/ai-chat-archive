/** 集中管理的阈值与默认值（对应技术方案 §14.2 / 附录 A） */
export const LIMITS = {
  MESSAGE_TEXT_MAX: 256 * 1024, // 单条文本上限 256KB
  SEARCH_RESULT_MAX: 200,
  ALIGN_MAX: 4000, // 单次参与 diff 的消息数上限
} as const;

export const TIMING = {
  DEBOUNCE_MS: 800,
  SCROLL_THROTTLE_MS: 250,
  ACCOUNT_CACHE_MS: 5000,
  /** touch 写回的最小间隔：内容未变且未移位时，低于该间隔跳过 put（流式期间防写放大） */
  TOUCH_REFRESH_MS: 60_000,
} as const;

export const ORDER_GAP = 1024;
export const DEFAULT_ACCOUNT_KEY = 'default';
export const DEFAULT_ACCOUNT_LABEL = '默认账号';
/** SW → 已打开归档页/弹窗 的同步通知频道（技术方案 §2.2 第 7 步） */
export const ARCHIVE_CHANNEL = 'ai-chat-archive';
