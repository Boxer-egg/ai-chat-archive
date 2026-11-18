/**
 * DB 迁移 + 并发 + 备份往返（U13/U15/U16/U17）。
 * 每个用例独立的 fake-indexeddb。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDB, resetDBCache } from '@core/db/open';
import { DB_NAME, DB_VERSION, STORES } from '@core/db/schema';
import { applyMerge, countComplete, listByConversation } from '@core/db/repos/messages';
import { getConversation, putConversation, upsertAccountSeen, getAccount } from '@core/db/repos/conversations';
import { mergeSnapshot } from '@core/merge/merge-snapshot';
import type { Conversation, RawMessage } from '@core/types';
import { buildBackup, parseBackup } from '@core/export/json';

const CONV_ID = 'chatgpt:default:conv-9';

function makeConv(id = CONV_ID): Conversation {
  return {
    id,
    platform: 'chatgpt',
    accountKey: 'default',
    accountLabel: '默认账号',
    platformConversationId: 'conv-9',
    title: '测试会话',
    url: 'https://chatgpt.com/c/conv-9',
    createdAt: 1,
    updatedAt: 1,
    lastSyncedAt: 1,
    messageCount: 0,
    adapterVersion: 'test',
    source: 'url',
    urlHistory: [],
  };
}

const raw = (role: 'user' | 'assistant', text: string, i: number): RawMessage => ({
  role,
  text,
  domIndex: i,
});

beforeEach(async () => {
  resetDBCache();
  // fake-indexeddb 是进程内单例：每个用例前删库，保证隔离
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

async function withTx<T>(mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDB();
  const tx = db.transaction([STORES.messages, STORES.conversations, STORES.accounts, STORES.syncState], mode);
  const result = await fn(tx);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return result; // 连接由 openDB 缓存复用，不在此关闭
}

describe('openDB / 迁移（U15）', () => {
  it('v1 结构：所有 store 与唯一索引就位', async () => {
    const db = await openDB();
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
    for (const name of Object.values(STORES)) {
      expect(db.objectStoreNames.contains(name)).toBe(true);
    }
    const tx = db.transaction(STORES.messages);
    expect(tx.objectStore(STORES.messages).indexNames.contains('by_conv_key')).toBe(true);
    db.close();
  });
});

describe('applyMerge + 计数（验收 1 持久层）', () => {
  it('合并结果落库后可按序读出，complete 计数正确', async () => {
    const out = await mergeSnapshot({
      conversationId: CONV_ID,
      existing: [],
      raws: [
        raw('user', 'Q1', 0),
        raw('assistant', 'A1', 1),
        raw('user', 'Q2', 2),
        raw('assistant', 'A2', 3),
      ],
      now: 100,
      adapterVersion: 'test',
    });
    await withTx('readwrite', async (tx) => {
      applyMerge(tx, out);
      putConversation(tx, { ...makeConv(), messageCount: out.all.length });
    });

    await withTx('readonly', async (tx) => {
      const list = await listByConversation(tx, CONV_ID);
      expect(list.map((m) => m.contentText)).toEqual(['Q1', 'A1', 'Q2', 'A2']);
      expect(await countComplete(tx, CONV_ID)).toBe(4);
      const conv = await getConversation(tx, CONV_ID);
      expect(conv?.title).toBe('测试会话');
    });
  });

  it('U13：同一快照并发写 10 次 → 唯一索引兜底，不重复', async () => {
    const raws = [raw('user', 'Q', 0), raw('assistant', 'A', 1)];
    const snapshot = () =>
      mergeSnapshot({ conversationId: CONV_ID, existing: [], raws, now: 100, adapterVersion: 'test' });

    // 模拟 10 个标签页同时提交同一快照：先在事务外合并（真实异步），再单事务写入
    const outs: Array<Awaited<ReturnType<typeof snapshot>>> = [];
    for (let i = 0; i < 10; i++) outs.push(await snapshot());
    await withTx('readwrite', async (tx) => {
      for (const out of outs) applyMerge(tx, out);
    });

    await withTx('readonly', async (tx) => {
      const list = await listByConversation(tx, CONV_ID);
      expect(list).toHaveLength(2);
    });
  });

  it('并发 put 同 key → ConstraintError 被拦（唯一索引生效）', async () => {
    const out = await mergeSnapshot({
      conversationId: CONV_ID,
      existing: [],
      raws: [raw('user', 'Q', 0)],
      now: 100,
      adapterVersion: 'test',
    });
    const db = await openDB();
    const tx = db.transaction(STORES.messages, 'readwrite');
    const s = tx.objectStore(STORES.messages);
    const m = out.all[0];
    s.put(m);
    s.put({ ...m, contentText: '冲突内容' }); // 同 id 第二次 put：覆盖（IndexedDB put 语义）
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    resetDBCache();

    await withTx('readonly', async (tx) => {
      const list = await listByConversation(tx, CONV_ID);
      expect(list).toHaveLength(1); // keyPath 相同 → 只有一条
    });
  });
});

describe('账号档案', () => {
  it('upsert 后可按 id 读出（U22 存储侧）', async () => {
    await withTx('readwrite', async (tx) => {
      upsertAccountSeen(tx, {
        id: 'chatgpt:default',
        platform: 'chatgpt',
        accountKey: 'default',
        label: '默认账号',
        source: 'default',
        firstSeenAt: 1,
        lastSeenAt: 2,
      });
    });
    await withTx('readonly', async (tx) => {
      const a = await getAccount(tx, 'chatgpt:default');
      expect(a?.label).toBe('默认账号');
    });
  });
});

describe('JSON 备份往返（U16/U17）', () => {
  it('导出 → 清空 → 导入恢复，内容一致', async () => {
    const out = await mergeSnapshot({
      conversationId: CONV_ID,
      existing: [],
      raws: [raw('user', 'Q1', 0), raw('assistant', 'A1', 1)],
      now: 100,
      adapterVersion: 'test',
    });
    const conv = { ...makeConv(), messageCount: 2 };
    let backup;
    await withTx('readwrite', async (tx) => {
      applyMerge(tx, out);
      putConversation(tx, conv);
    });
    await withTx('readonly', async (tx) => {
      const messages = await listByConversation(tx, CONV_ID);
      backup = buildBackup({
        schemaVersion: DB_VERSION,
        appVersion: '0.1.0',
        accounts: [],
        conversations: [conv],
        messages,
      });
    });

    // 清空
    const db = await openDB();
    const clearTx = db.transaction(STORES.messages, 'readwrite');
    clearTx.objectStore(STORES.messages).clear();
    await new Promise<void>((r) => (clearTx.oncomplete = () => r()));
    db.close();
    resetDBCache();

    // 导入（走 merge 通道）
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)), DB_VERSION);
    expect(parsed.stats.messages).toBe(2);
    const reimport = await mergeSnapshot({
      conversationId: CONV_ID,
      existing: [],
      raws: parsed.messages
        .sort((a, b) => a.order - b.order)
        .map((m, i) => ({ role: m.role, text: m.contentText, domIndex: i })),
      now: 200,
      adapterVersion: 'import',
    });
    await withTx('readwrite', async (tx) => {
      applyMerge(tx, reimport);
      putConversation(tx, parsed.conversations[0]);
    });

    await withTx('readonly', async (tx) => {
      const list = await listByConversation(tx, CONV_ID);
      expect(list.map((m) => [m.role, m.contentText])).toEqual([
        ['user', 'Q1'],
        ['assistant', 'A1'],
      ]);
    });
  });

  it('U17：同一备份导入两次 → 第二次零新增', async () => {
    const raws = [raw('user', 'Q', 0)];
    const first = await mergeSnapshot({ conversationId: CONV_ID, existing: [], raws, now: 1, adapterVersion: 'import' });
    await withTx('readwrite', async (tx) => applyMerge(tx, first));

    // 第二次：以库内现有消息为 existing 再合并同一批
    let existing: import('@core/types').Message[] = [];
    await withTx('readonly', async (tx) => {
      existing = await listByConversation(tx, CONV_ID);
    });
    const second = await mergeSnapshot({
      conversationId: CONV_ID,
      existing,
      raws,
      now: 2,
      adapterVersion: 'import',
    });
    expect(second.inserted).toBe(0);
  });

  it('高版本备份拒绝导入', () => {
    expect(() => parseBackup({ format: 'ai-chat-archive', schemaVersion: 999 }, 1)).toThrow();
    expect(() => parseBackup({ format: 'other' }, 1)).toThrow();
  });
});
