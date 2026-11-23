/**
 * Background Service Worker：路由 + 串行队列 + 角标。
 * 唯一写库者；每次消息 ensureReady()，不假设自己一直活着。
 */
import { PROTOCOL, type ProtocolMessage } from '../core/protocol';
import { openDB } from '../core/db/open';
import { SyncService } from './sync-service';
import { SyncQueue } from './sync-queue';
import { setBadge } from './badge';
import * as handlers from './bg-handlers';

const queue = new SyncQueue();
let syncService: SyncService | null = null;

async function ensureReady(): Promise<SyncService> {
  // openDB() 有缓存；连接被浏览器回收后会自愈返回新实例，
  // 此时必须重建 SyncService，避免持有已失效的旧连接
  const db = await openDB();
  if (!syncService || syncService.db !== db) {
    syncService = new SyncService({ db });
  }
  return syncService;
}

function respond(promise: Promise<unknown>, sendResponse: (r?: unknown) => void) {
  promise.then(sendResponse).catch((err) => {
    console.error('[archive] handler error', err);
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    // 落一份到 storage：弹窗/归档页可直接显示，远程排障不靠猜
    void chrome.storage.local.set({
      lastError: { ts: Date.now(), message, stack: err instanceof Error ? err.stack : undefined },
    });
    sendResponse({ error: message });
  });
}

chrome.runtime.onMessage.addListener((msg: ProtocolMessage, sender, sendResponse) => {
  switch (msg.type) {
    case PROTOCOL.UPSERT_SNAPSHOT: {
      const host = sender.tab?.url ? new URL(sender.tab.url).hostname : '';
      const key = `${msg.payload.adapterId}:${msg.payload.accountKey}:${msg.payload.conversation.platformConversationId}`;
      respond(
        (async () => {
          const settings = await handlers.getSettings();
          if (handlers.hostPaused(settings, host)) {
            if (sender.tab?.id !== undefined) await setBadge(sender.tab.id, 'paused');
            return { paused: true };
          }
          const svc = await ensureReady();
          const result = await queue.enqueue(key, () => svc.upsertSnapshot(msg.payload));
          if (sender.tab?.id !== undefined) {
            await setBadge(sender.tab.id, 'active', result.messageCount);
          }
          return result;
        })(),
        sendResponse,
      );
      return true;
    }
    case PROTOCOL.GET_SETTINGS:
      respond(handlers.getSettings(), sendResponse);
      return true;
    case PROTOCOL.SET_SETTINGS:
      respond(handlers.setSettings(msg.patch), sendResponse);
      return true;
    case PROTOCOL.LIST_ACCOUNTS:
      respond(handlers.listAccounts(), sendResponse);
      return true;
    case PROTOCOL.LIST_CONVERSATIONS:
      respond(handlers.listConvs(msg.filter ?? {}), sendResponse);
      return true;
    case PROTOCOL.GET_MESSAGES:
      respond(handlers.getMessages(msg.conversationId), sendResponse);
      return true;
    case PROTOCOL.SEARCH_MESSAGES:
      respond(handlers.search(msg.request), sendResponse);
      return true;
    case PROTOCOL.DELETE_CONVERSATION:
      respond(handlers.deleteConversation(msg.conversationId), sendResponse);
      return true;
    case PROTOCOL.CLEAR_ALL:
      respond(handlers.clearAllData(), sendResponse);
      return true;
    case PROTOCOL.EXPORT_JSON:
      respond(handlers.exportJson(msg.conversationId), sendResponse);
      return true;
    case PROTOCOL.EXPORT_OPENAI:
      respond(handlers.exportOpenAI(msg.conversationId), sendResponse);
      return true;    case PROTOCOL.IMPORT_PREVIEW:
      respond(handlers.importPreview(msg.backupJson), sendResponse);
      return true;
    case PROTOCOL.IMPORT_APPLY:
      respond(handlers.importApply(msg.backupJson), sendResponse);
      return true;
    default:
      return false; // GET_CONTENT_STATUS / FORCE_SYNC 由内容脚本处理
  }
});
