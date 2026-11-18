/**
 * 内容脚本入口（技术方案 §2.1 bootstrap）。
 * 生命周期要点（2026-11-03 真机修复）：
 * - 消息监听必须**第一时间注册**，适配器按需解析——SPA（如 ChatGPT 首页 → /c/xxx）
 *   路由变化后要能重新初始化，不能因为首屏 URL 不支持就永远静默。
 */
import { adapterForUrl } from './adapters/registry';
import type { PlatformAdapter } from '../core/types';
import { extractSnapshot } from './extractor';
import { resolveAccount, resetAccountCache } from './account';
import { debounce } from './observer';
import { PROTOCOL, type ContentStatus, type SnapshotPayload } from '../core/protocol';
import type { MergeResult } from '../core/types';
import { TIMING } from '../shared/constants';

declare global {
  interface Window {
    __AI_ARCHIVE_LOADED__?: boolean;
  }
}

interface SessionState {
  adapter: PlatformAdapter | null;
  lastSync: MergeResult | null;
  health: ContentStatus['health'];
  conversationId: string | null;
  accountLabel: string | null;
  title: string | null;
  rawCount: number;
  observersBound: boolean;
  mo: MutationObserver | null;
  routeTimer: number | null;
}

const state: SessionState = {
  adapter: null,
  lastSync: null,
  health: 'unknown',
  conversationId: null,
  accountLabel: null,
  title: null,
  rawCount: 0,
  observersBound: false,
  mo: null,
  routeTimer: null,
};

const urlNow = () => new URL(location.href);
const ctx = () => ({ url: urlNow(), document, now: Date.now() });

function bindObservers(): void {
  if (state.observersBound || !state.adapter) return;
  const c = ctx();
  const root = state.adapter.getMessageRoot(c);
  if (root) {
    const mo = new MutationObserver(() => sendSnapshot());
    mo.observe(root, { childList: true, subtree: true });
    state.mo = mo;
  }
  const scroller = state.adapter.getScrollContainer(c);
  if (scroller) {
    scroller.addEventListener(
      'scroll',
      debounce(() => sendSnapshot(), TIMING.SCROLL_THROTTLE_MS),
      { passive: true },
    );
  }
  state.observersBound = true;
}

/** 按当前 URL 解析适配器；变化时重置观察绑定 */
function reevaluate(): void {
  const adapter = adapterForUrl(urlNow());
  if (adapter?.id !== state.adapter?.id) {
    state.mo?.disconnect();
    state.observersBound = false;
    state.adapter = adapter;
    state.conversationId = null;
    state.lastSync = null;
    state.health = 'unknown';
  }
  if (state.adapter) bindObservers();
}

async function buildPayload(): Promise<SnapshotPayload | null> {
  if (!state.adapter) return null;
  const c = ctx();
  const conv = state.adapter.getConversation(c);
  if (!conv) return null; // 新会话还没 URL ID
  const account = await resolveAccount(state.adapter, c);
  const { raws, parseFailures } = extractSnapshot(state.adapter, c);
  const title = state.adapter.getTitle(c);
  state.conversationId = `${state.adapter.id}:${account.key}:${conv.platformConversationId}`;
  state.accountLabel = account.label;
  state.title = title;
  state.rawCount = raws.length;
  state.health = parseFailures > 0 ? 'degraded' : raws.length === 0 ? 'broken' : 'ok';
  return {
    accountKey: account.key,
    accountLabel: account.label,
    accountSource: 'default',
    conversation: conv,
    conversationUrl: c.url.href,
    title,
    raws,
    adapterId: state.adapter.id,
    adapterVersion: state.adapter.version,
    platformMessageCount: raws.length,
  };
}

async function snapshotNow(): Promise<MergeResult | null> {
  try {
    const payload = await buildPayload();
    if (!payload) return null;
    const res = (await chrome.runtime.sendMessage({
      type: PROTOCOL.UPSERT_SNAPSHOT,
      payload,
    })) as (MergeResult & { paused?: boolean; error?: string }) | undefined;
    if (!res) return null;
    state.lastSync = res;
    return res;
  } catch {
    return null; // SW 休眠/未响应：下一次自然重试（幂等）
  }
}

const sendSnapshot = debounce(() => void snapshotNow(), TIMING.DEBOUNCE_MS);

function main(): void {
  if (window.__AI_ARCHIVE_LOADED__) return;
  window.__AI_ARCHIVE_LOADED__ = true;

  // 1) 先装弹窗通信监听（最重要：无论当前页是否支持）
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === PROTOCOL.GET_CONTENT_STATUS) {
      reevaluate();
      const status: ContentStatus = {
        hasConversation: state.conversationId !== null,
        adapterId: state.adapter?.id ?? null,
        adapterVersion: state.adapter?.version ?? null,
        conversationId: state.conversationId,
        accountLabel: state.accountLabel,
        title: state.title,
        platformMessageCount: state.rawCount,
        lastSync: state.lastSync,
        health: state.health,
      };
      sendResponse(status);
      return false;
    }
    if (msg?.type === PROTOCOL.FORCE_SYNC) {
      void snapshotNow().then((r) => sendResponse(r));
      return true;
    }
    return false;
  });

  // 2) 初始化 + SPA 路由跟随（每秒检查 URL 变化，重建适配器与观察）
  reevaluate();
  let lastHref = location.href;
  state.routeTimer = window.setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      resetAccountCache();
      reevaluate();
      sendSnapshot();
    }
  }, 1000);

  window.addEventListener('pagehide', () => {
    if (state.routeTimer !== null) clearInterval(state.routeTimer);
    sendSnapshot.flush();
  });

  // 3) 首次采集
  sendSnapshot();
}

main();
