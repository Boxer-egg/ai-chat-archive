// @vitest-environment jsdom
/**
 * SyncService 真机 bug 复现：用真实 Kimi 夹具解析出的 payload 跑 upsertSnapshot。
 * 2026-11-03 用户反馈：Kimi 弹窗显示"已归档 undefined 条"、归档页为空 → SW 写库异常。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDB, resetDBCache } from '@core/db/open';
import { DB_NAME } from '@core/db/schema';
import { SyncService } from '../../src/background/sync-service';
import { kimiAdapter } from '../../src/content/adapters/kimi';
import { makeCtx } from '../../src/content/adapters/base';
import type { SnapshotPayload } from '@core/protocol';

const html = readFileSync(join(__dirname, '../integration/fixtures/real/kimi-chat.html'), 'utf-8');

function buildPayload(): SnapshotPayload {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const ctx = makeCtx('https://www.kimi.com/chat/1a191987-8fb2-8aad-8000-094650f7c061', doc);
  const raws = kimiAdapter
    .getMessageNodes(ctx)
    .map((n) => kimiAdapter.parseMessage(n, ctx))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return {
    accountKey: 'aaaa1111bbbb',
    accountLabel: '抓***铺',
    accountSource: 'avatar',
    conversation: { platformConversationId: '1a191987-8fb2-8aad-8000-094650f7c061', source: 'url' },
    conversationUrl: ctx.url.href,
    title: kimiAdapter.getTitle(ctx),
    raws,
    adapterId: 'kimi',
    adapterVersion: kimiAdapter.version,
    platformMessageCount: raws.length,
  };
}

beforeEach(async () => {
  resetDBCache();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('SyncService.upsertSnapshot（真机异常复现）', () => {
  it('Kimi payload 正常落库并可读回', async () => {
    const db = await openDB();
    const svc = new SyncService({ db });
    const result = await svc.upsertSnapshot(buildPayload());
    // 12 段中 2 条是纯图片消息（空文本），按设计跳过（技术方案 §1.1：只存文本与代码块）
    expect(result.messageCount).toBe(10);
    expect(result.inserted).toBe(10);

    // 二次相同快照 → 幂等
    const again = await svc.upsertSnapshot(buildPayload());
    expect(again.inserted).toBe(0);
    expect(again.messageCount).toBe(10);
  });

  it('空快照不建"未命名会话 0 条"残留（首屏 DOM 未就绪）', async () => {
    const db = await openDB();
    const svc = new SyncService({ db });
    const payload = buildPayload();
    const result = await svc.upsertSnapshot({ ...payload, raws: [], platformMessageCount: 0 });
    expect(result.messageCount).toBe(0);
    expect(result.inserted).toBe(0);
    // 会话记录不应被创建
    const rtx = db.transaction('conversations', 'readonly');
    const req = rtx.objectStore('conversations').get(payload.conversation.platformConversationId && `${payload.adapterId}:${payload.accountKey}:${payload.conversation.platformConversationId}`);
    const conv = await new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
    });
    expect(conv).toBeUndefined();
  });
});
