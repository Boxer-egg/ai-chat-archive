/** SW 侧协议处理：设置 / 列表 / 搜索 / 导出导入 / 清空。事务内不做真异步（先收集后写入）。 */
import { openDB } from '../core/db/open';
import { STORES, DB_VERSION } from '../core/db/schema';
import {
  getConversation,
  listConversations,
  putConversation,
  listAccounts as listAccountsRepo,
  deleteConversationRecord,
  deleteMessagesOf,
} from '../core/db/repos/conversations';
import { listByConversation } from '../core/db/repos/messages';
import { searchMessages } from '../core/search';
import { buildBackup, estimateBackupBytes, parseBackup, type BackupFile } from '../core/export/json';
import { conversationToMarkdown } from '../core/export/markdown';
import { mergeSnapshot } from '../core/merge/merge-snapshot';
import { applyMerge } from '../core/db/repos/messages';
import { DEFAULT_SETTINGS, type Settings } from '../core/protocol';
import type { Account, Conversation, Message } from '../core/types';

const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(raw[SETTINGS_KEY] ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function hostPaused(settings: Settings, host: string): boolean {
  return !settings.autoSave || settings.disabledHosts.includes(host);
}

// ---------- 列表 ----------

export async function listAccounts(): Promise<Account[]> {
  const db = await openDB();
  const tx = db.transaction(STORES.accounts, 'readonly');
  const out = await listAccountsRepo(tx);
  await txDone(tx);
  return out;
}

export async function listConvs(filter: { platform?: string; accountKey?: string } = {}): Promise<Conversation[]> {
  const db = await openDB();
  const tx = db.transaction(STORES.conversations, 'readonly');
  const out = (await listConversations(tx, filter)).sort((a, b) => b.updatedAt - a.updatedAt);
  await txDone(tx);
  return out;
}

export async function getMessages(conversationId: string) {
  const db = await openDB();
  const rtx = db.transaction([STORES.conversations, STORES.messages], 'readonly');
  const [conversation, messages] = await Promise.all([
    getConversation(rtx, conversationId),
    listByConversation(rtx, conversationId),
  ]);
  await txDone(rtx);
  return { conversation, messages };
}

// ---------- 搜索 ----------

export async function search(req: Parameters<typeof searchMessages>[0]['request']) {
  const db = await openDB();
  const rtx = db.transaction([STORES.conversations, STORES.messages], 'readonly');
  const conversations = await listConversations(rtx, {});
  const messages: Message[] = [];
  // MVP：全量收集（几万条内可接受）；量大后改为分批喂给 searchMessages。
  // 搜索只需要纯文本，剥离 contentHtml 降低峰值内存（IndexedDB 返回的是结构化克隆，改写安全）
  for (const c of conversations) {
    for (const m of await listByConversation(rtx, c.id)) {
      m.contentHtml = undefined;
      messages.push(m);
    }
  }
  await txDone(rtx);
  return searchMessages({ conversations, messages, request: req });
}

// ---------- 删除 / 清空 ----------

export async function deleteConversation(conversationId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORES.conversations, STORES.messages, STORES.syncState], 'readwrite');
  deleteConversationRecord(tx, conversationId);
  await deleteMessagesOf(tx, conversationId);
  await txDone(tx);
}

export async function clearAllData(): Promise<void> {
  const db = await openDB();
  const stores = [STORES.conversations, STORES.accounts, STORES.messages, STORES.events, STORES.syncState];
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  await txDone(tx);
}

// ---------- 导出 ----------

async function collectBackup(conversationId?: string): Promise<BackupFile> {
  const db = await openDB();
  const rtx = db.transaction([STORES.conversations, STORES.messages, STORES.accounts], 'readonly');
  const conversations = await listConversations(rtx, {});
  const targets = conversationId ? conversations.filter((c) => c.id === conversationId) : conversations;
  const messages: Message[] = [];
  for (const c of targets) messages.push(...(await listByConversation(rtx, c.id)));
  const accounts = (await listAccountsRepo(rtx)).filter((a) =>
    targets.some((c) => c.platform === a.platform && c.accountKey === a.accountKey),
  );
  await txDone(rtx);
  return buildBackup({
    schemaVersion: DB_VERSION,
    appVersion: chrome.runtime.getManifest().version,
    accounts,
    conversations: targets,
    messages,
  });
}

export async function exportJson(conversationId?: string) {
  return { backup: await collectBackup(conversationId) };
}

export async function exportMarkdown(conversationId?: string) {
  const backup = await collectBackup(conversationId);
  const byConv = new Map<string, Message[]>();
  for (const m of backup.messages) {
    const arr = byConv.get(m.conversationId) ?? [];
    arr.push(m);
    byConv.set(m.conversationId, arr);
  }
  const parts = backup.conversations.map((c) =>
    conversationToMarkdown(c, (byConv.get(c.id) ?? []).sort((a, b) => a.order - b.order)),
  );
  return { markdown: parts.join('\n\n---\n\n') };
}

// ---------- 导入 ----------

function readBackup(backupJson: string): BackupFile {
  return parseBackup(JSON.parse(backupJson), DB_VERSION);
}

export async function importPreview(backupJson: string) {
  const backup = readBackup(backupJson);
  const byConv = new Map<string, number>();
  for (const m of backup.messages) byConv.set(m.conversationId, (byConv.get(m.conversationId) ?? 0) + 1);
  return {
    plan: {
      conversations: backup.conversations.length,
      messages: backup.messages.length,
      estimateBytes: estimateBackupBytes(backup),
      perConversation: [...byConv.entries()].map(([conversationId, messages]) => ({ conversationId, messages })),
    },
  };
}

export async function importApply(backupJson: string) {
  const backup = readBackup(backupJson);
  const db = await openDB();
  let inserted = 0;
  let updated = 0;

  const byConv = new Map<string, Message[]>();
  for (const m of backup.messages) {
    const arr = byConv.get(m.conversationId) ?? [];
    arr.push(m);
    byConv.set(m.conversationId, arr);
  }

  for (const conv of backup.conversations) {
    const msgs = (byConv.get(conv.id) ?? []).sort((a, b) => a.order - b.order);
    const rtx = db.transaction(STORES.messages, 'readonly');
    const existing = await listByConversation(rtx, conv.id);
    await txDone(rtx);

    const out = await mergeSnapshot({
      conversationId: conv.id,
      existing,
      raws: msgs.map((m, i) => ({
        role: m.role,
        text: m.contentText,
        html: m.contentHtml,
        domIndex: i,
        platformMessageId: m.platformMessageId,
        timestamp: m.timestamp,
      })),
      now: Date.now(),
      adapterVersion: 'import',
    });

    const wtx = db.transaction([STORES.messages, STORES.conversations], 'readwrite');
    applyMerge(wtx, out);
    putConversation(wtx, { ...conv, messageCount: out.all.filter((m) => m.status === 'complete').length });
    await txDone(wtx);
    inserted += out.inserted;
    updated += out.updated;
  }
  return { inserted, updated, conversations: backup.conversations.length, messages: backup.messages.length };
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
