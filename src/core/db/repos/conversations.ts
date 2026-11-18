/** conversations / accounts / syncState / events 访问层 */
import type { Account, Conversation, SyncState } from '../../types';
import { STORES } from '../schema';

export async function getConversation(tx: IDBTransaction, id: string): Promise<Conversation | undefined> {
  const req = tx.objectStore(STORES.conversations).get(id);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as Conversation | undefined);
    req.onerror = () => reject(req.error);
  });
}

export function putConversation(tx: IDBTransaction, conv: Conversation): void {
  tx.objectStore(STORES.conversations).put(conv);
}

export async function listConversations(
  tx: IDBTransaction,
  opts: { platform?: string; accountKey?: string } = {},
): Promise<Conversation[]> {
  const s = tx.objectStore(STORES.conversations);
  const source =
    opts.platform && opts.accountKey
      ? s.index('by_platform_account_pcid')
      : opts.platform
        ? s.index('by_platform')
        : opts.accountKey
          ? s.index('by_account')
          : s.index('by_updatedAt');
  const out: Conversation[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = source.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const v = c.value as Conversation;
      if (opts.platform && v.platform !== opts.platform) {
        c.continue();
        return;
      }
      if (opts.accountKey && v.accountKey !== opts.accountKey) {
        c.continue();
        return;
      }
      out.push(v);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out;
}

export function upsertAccountSeen(tx: IDBTransaction, account: Account): void {
  tx.objectStore(STORES.accounts).put(account);
}

export async function getAccount(tx: IDBTransaction, id: string): Promise<Account | undefined> {
  const req = tx.objectStore(STORES.accounts).get(id);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as Account | undefined);
    req.onerror = () => reject(req.error);
  });
}

export function putSyncState(tx: IDBTransaction, state: SyncState): void {
  tx.objectStore(STORES.syncState).put(state);
}

export async function getSyncState(tx: IDBTransaction, conversationId: string): Promise<SyncState | undefined> {
  const req = tx.objectStore(STORES.syncState).get(conversationId);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as SyncState | undefined);
    req.onerror = () => reject(req.error);
  });
}


export async function listAccounts(tx: IDBTransaction): Promise<Account[]> {
  const out: Account[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = tx.objectStore(STORES.accounts).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      out.push(c.value as Account);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out;
}

/** 删除会话记录与同步状态（消息删除见 deleteMessagesOf，同一事务内先后调用） */
export function deleteConversationRecord(tx: IDBTransaction, conversationId: string): void {
  tx.objectStore(STORES.conversations).delete(conversationId);
  tx.objectStore(STORES.syncState).delete(conversationId);
}

/** 逐条删消息（游标 delete），要求在 readwrite 事务内调用 */
export async function deleteMessagesOf(tx: IDBTransaction, conversationId: string): Promise<void> {
  const idx = tx.objectStore(STORES.messages).index('by_conv_order');
  await new Promise<void>((resolve, reject) => {
    const req = idx.openCursor(IDBKeyRange.lowerBound([conversationId]));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const key = c.key as [string, number];
      if (key[0] !== conversationId) return resolve();
      c.delete();
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
