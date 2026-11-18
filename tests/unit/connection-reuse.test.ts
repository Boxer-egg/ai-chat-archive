/**
 * 回归测试（2026-11-03 真机 bug）：bg-handlers 曾对每个操作 db.close()，
 * 而连接由 openDB 全局缓存 → 第一次操作后连接被关，后续全部
 * "InvalidStateError: The database connection is closing"。
 * 本测试模拟多次连续操作共享缓存连接。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDB, resetDBCache } from '@core/db/open';
import { DB_NAME, STORES } from '@core/db/schema';
import { listAccounts, listConversations, putConversation } from '@core/db/repos/conversations';
import { listByConversation } from '@core/db/repos/messages';
import type { Conversation } from '@core/types';

const conv = (id: string): Conversation => ({
  id,
  platform: 'kimi',
  accountKey: 'k1',
  accountLabel: '默认账号',
  platformConversationId: id,
  title: '回归测试',
  url: 'https://example.com',
  createdAt: 1,
  updatedAt: 1,
  lastSyncedAt: 1,
  messageCount: 0,
  adapterVersion: 't',
  source: 'url',
  urlHistory: [],
});

beforeEach(async () => {
  resetDBCache();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

async function rw<T>(fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDB();
  const tx = db.transaction([STORES.conversations, STORES.accounts, STORES.messages, STORES.syncState], 'readwrite');
  const out = await fn(tx);
  await new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  return out;
}

async function ro<T>(fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDB();
  const tx = db.transaction([STORES.conversations, STORES.accounts, STORES.messages], 'readonly');
  const out = await fn(tx);
  await new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  return out;
}

describe('连接复用（多操作共享缓存连接）', () => {
  it('连续 6 次操作（写读交替）连接保持可用', async () => {
    await rw(async (tx) => putConversation(tx, conv('c1')));
    let list = await ro((tx) => listConversations(tx, {}));
    expect(list).toHaveLength(1);

    await rw(async (tx) => putConversation(tx, conv('c2')));
    list = await ro((tx) => listConversations(tx, {}));
    expect(list).toHaveLength(2);

    const accounts = await ro((tx) => listAccounts(tx));
    expect(accounts).toHaveLength(0);

    const msgs = await ro((tx) => listByConversation(tx, 'c1'));
    expect(msgs).toHaveLength(0);

    // 再来一轮写读
    await rw(async (tx) => putConversation(tx, conv('c3')));
    list = await ro((tx) => listConversations(tx, { platform: 'kimi' }));
    expect(list).toHaveLength(3);
  });
});
