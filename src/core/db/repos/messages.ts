/** messages store 访问层。所有函数都要求在调用方开启的事务内使用。 */
import type { Message } from '../../types';
import { STORES } from '../schema';
import type { MergeOutput } from '../../merge/merge-snapshot';

function store(tx: IDBTransaction): IDBObjectStore {
  return tx.objectStore(STORES.messages);
}

export async function listByConversation(tx: IDBTransaction, conversationId: string): Promise<Message[]> {
  const idx = store(tx).index('by_conv_order');
  const out: Message[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = idx.openCursor(IDBKeyRange.lowerBound([conversationId]));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const key = c.key as [string, number];
      if (key[0] !== conversationId) return resolve(); // 越过本会话范围
      out.push(c.value as Message);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out;
}

export async function countComplete(tx: IDBTransaction, conversationId: string): Promise<number> {
  const idx = store(tx).index('by_conv_status');
  let n = 0;
  await new Promise<void>((resolve, reject) => {
    const req = idx.openKeyCursor(IDBKeyRange.bound([conversationId, 'complete'], [conversationId, 'complete']));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      n++;
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return n;
}

/** 在单个事务内应用合并结果（原子：要么全成要么全败） */
export async function applyMerge(tx: IDBTransaction, out: MergeOutput): Promise<void> {
  const s = store(tx);
  for (const m of out.inserts) s.put(m);
  for (const { old, next } of out.updates) {
    if (old.id !== next.id) s.delete(old.id);
    s.put(next);
  }
  for (const m of out.touches) s.put(m);
}
