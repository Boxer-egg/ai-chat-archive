/** 集中管理的阈值与默认值（对应技术方案 §14.2 / 附录 A） */
export const LIMITS = {
  MESSAGE_TEXT_MAX: 256 * 1024, // 单条文本上限 256KB
  EVENT_LOG_MAX: 500,
  SEARCH_RESULT_MAX: 200,
  ALIGN_MAX: 4000, // 单次参与 diff 的消息数上限
  TX_CHUNK: 200, // 单事务批量
  RETRY_DELAYS_MS: [1000, 3000, 10000] as const,
} as const;

export const TIMING = {
  DEBOUNCE_MS: 800,
  // 流式草稿节流（STREAM_THROTTLE_MS / STREAM_MIN_DELTA / STABLE_MS）与标题防抖
  // 随 DraftTracker 一起暂未接线，接线前保留在此
  STREAM_THROTTLE_MS: 1500,
  STREAM_MIN_DELTA: 20, // 字符
  STABLE_MS: 1200, // 完成判定静默期
  TITLE_DEBOUNCE_MS: 800,
  SCROLL_THROTTLE_MS: 250,
  ACCOUNT_CACHE_MS: 5000,
  /** touch 写回的最小间隔：内容未变且未移位时，低于该间隔跳过 put（流式期间防写放大） */
  TOUCH_REFRESH_MS: 60_000,
} as const;

export const ORDER_GAP = 1024;
export const DEFAULT_ACCOUNT_KEY = 'default';
export const DEFAULT_ACCOUNT_LABEL = '默认账号';
