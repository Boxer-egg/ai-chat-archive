/**
 * 同步服务（技术方案 §2.2 第 4–6 步）：读 → 合并 → 单事务提交 → 回执。
 * 不依赖 chrome.*，可用 fake-indexeddb 单测。
 */
import type { Conversation, SyncState } from '../core/types';
import type { SnapshotPayload } from '../core/protocol';
import type { MergeResult } from '../core/types';
import { mergeSnapshot } from '../core/merge/merge-snapshot';
import { STORES } from '../core/db/schema';
import {
  getAccount,
  getConversation,
  putConversation,
  putSyncState,
  upsertAccountSeen,
} from '../core/db/repos/conversations';
import { applyMerge, listByConversation } from '../core/db/repos/messages';

const PLACEHOLDER_TITLES = new Set(['new chat', '新对话', 'untitled', '未命名']);

export interface SyncDeps {
  db: IDBDatabase;
}

export class SyncService {
  constructor(private deps: SyncDeps) {}

  /** 当前持有的连接；调用方用于检测浏览器回收连接后重建实例 */
  get db(): IDBDatabase {
    return this.deps.db;
  }

  private tx(mode: IDBTransactionMode) {
    return this.deps.db.transaction(
      [STORES.conversations, STORES.accounts, STORES.messages, STORES.syncState],
      mode,
    );
  }

  async upsertSnapshot(payload: SnapshotPayload): Promise<MergeResult> {
    const now = Date.now();
    const { conversation } = payload;
    const conversationId = `${payload.adapterId}:${payload.accountKey}:${conversation.platformConversationId}`;

    const readTx = this.tx('readonly');
    const readDone = txComplete(readTx); // 先挂完成回调，避免时序竞争
    const [existingConv, existingMsgs, account] = await Promise.all([
      getConversation(readTx, conversationId),
      listByConversation(readTx, conversationId),
      getAccount(readTx, `${payload.adapterId}:${payload.accountKey}`),
    ]);
    await readDone;

    const out = await mergeSnapshot({
      conversationId,
      existing: existingMsgs,
      raws: payload.raws,
      now,
      adapterVersion: payload.adapterVersion,
    });

    const writeTx = this.tx('readwrite');
    const writeDone = txComplete(writeTx); // 先挂完成回调
    const titleChanged =
      !!payload.title &&
      payload.title !== existingConv?.title &&
      !PLACEHOLDER_TITLES.has(payload.title.toLowerCase());
    try {
      applyMerge(writeTx, out);

      // 账号档案：首次见到建档案，见到即刷新 lastSeenAt
      upsertAccountSeen(writeTx, {
        id: `${payload.adapterId}:${payload.accountKey}`,
        platform: payload.adapterId as Conversation['platform'],
        accountKey: payload.accountKey,
        label: payload.accountLabel,
        source: account?.source ?? payload.accountSource,
        firstSeenAt: account?.firstSeenAt ?? now,
        lastSeenAt: now,
      });

      // 会话记录：标题只更新字段，不动计数之外的数据
      const next: Conversation = existingConv
        ? {
            ...existingConv,
            title: titleChanged ? payload.title! : existingConv.title,
            url: payload.conversationUrl,
            urlHistory: existingConv.urlHistory.includes(payload.conversationUrl)
              ? existingConv.urlHistory
              : [...existingConv.urlHistory, payload.conversationUrl],
            updatedAt: now,
            lastSyncedAt: now,
            messageCount: out.all.filter((m) => m.status === 'complete').length,
            adapterVersion: payload.adapterVersion,
          }
        : {
            id: conversationId,
            platform: payload.adapterId as Conversation['platform'],
            accountKey: payload.accountKey,
            accountLabel: payload.accountLabel,
            platformConversationId: conversation.platformConversationId,
            title: payload.title ?? '未命名会话',
            url: payload.conversationUrl,
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: now,
            messageCount: out.all.filter((m) => m.status === 'complete').length,
            adapterVersion: payload.adapterVersion,
            source: conversation.source,
            urlHistory: [payload.conversationUrl],
          };
      putConversation(writeTx, next);

      const state: SyncState = {
        conversationId,
        lastAttemptAt: now,
        lastResult: 'ok',
        snapshotHash: '',
      };
      putSyncState(writeTx, state);
    } catch (err) {
      writeTx.abort();
      throw err;
    }
    await writeDone;

    return {
      inserted: out.inserted,
      updated: out.updated,
      touched: out.touches.length,
      skipped: Math.max(0, payload.raws.length - out.inserted - out.updated - out.touches.length),
      messageCount: out.all.filter((m) => m.status === 'complete').length,
      conversationTitleChanged: titleChanged,
      orderRenumbered: out.renumbered,
    };
  }
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
