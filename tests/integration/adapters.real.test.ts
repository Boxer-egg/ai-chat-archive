// @vitest-environment jsdom
/**
 * 真实页面样例的适配器验证测试。
 * 夹具来源（2026-10-31 用户保存的完整会话页）：
 * - claude-chat.html：Edge 保存，含 1 轮对话（用户 + 助手）
 * - deepseek-chat.html：含可见窗口内 1 用户 + 1 助手（虚拟列表只渲染可见项）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeAdapter } from '../../src/content/adapters/claude';
import { deepseekAdapter } from '../../src/content/adapters/deepseek';
import { makeCtx } from '../../src/content/adapters/base';

const FIX = (name: string) => readFileSync(join(__dirname, 'fixtures/real', name), 'utf-8');
const docOf = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('Claude 真实样例（已实测选择器）', () => {
  const html = FIX('claude-chat.html');
  const doc = docOf(html);
  const url = 'https://claude.ai/chat/e36864b2-733a-4877-a152-37381e5eac2c';
  const ctx = makeCtx(url, doc);

  it('match + 会话 ID + 标题', () => {
    expect(claudeAdapter.match(ctx.url)).toBe(true);
    expect(claudeAdapter.getConversation(ctx)?.platformConversationId).toBe('e36864b2-733a-4877-a152-37381e5eac2c');
    expect(claudeAdapter.getTitle(ctx)).toBe('油车与电车生命周期成本对比');
  });

  it('2 条消息：角色正确、带 turn-key、助手正文无状态噪音', () => {
    const nodes = claudeAdapter.getMessageNodes(ctx);
    expect(nodes).toHaveLength(2);
    const raws = nodes.map((n) => claudeAdapter.parseMessage(n, ctx));
    expect(raws.every((r) => r !== null)).toBe(true);
    const [u, a] = raws as NonNullable<(typeof raws)[number]>[];
    expect(u.role).toBe('user');
    expect(a.role).toBe('assistant');
    expect(u.text).toContain('15 万元');
    expect(a.text).toContain('小计算器');
    // 同一轮的 turn-key 应一致（assistant 去掉 -hub-reply 后缀）
    expect(a.platformMessageId).toBe(u.platformMessageId);
    // 正文不应混入"已思考"等状态文本与 Artifact 浮层占位（show_widget 是浮层芯片文本）
    expect(a.text).not.toMatch(/已思考|正在思考/);
    expect(a.text).not.toContain('show_widget');
    expect(claudeAdapter.isStreaming(ctx)).toBe(false);
  });

  it('账号线索：user-menu-button', () => {
    const hint = claudeAdapter.getAccountHint(ctx);
    expect(hint).not.toBeNull();
    expect(hint!.label.length).toBeGreaterThan(0);
  });

  it('diagnose ok', () => {
    expect(claudeAdapter.diagnose(ctx).status).toBe('ok');
  });
});

describe('DeepSeek 真实样例（已实测选择器）', () => {
  const html = FIX('deepseek-chat.html');
  const doc = docOf(html);
  const url = 'https://chat.deepseek.com/a/chat/s/9845e519-61a6-411a-93d3-beccde64cd34';
  const ctx = makeCtx(url, doc);

  it('match + 会话 ID + 标题', () => {
    expect(deepseekAdapter.match(ctx.url)).toBe(true);
    expect(deepseekAdapter.getConversation(ctx)?.platformConversationId).toBe('9845e519-61a6-411a-93d3-beccde64cd34');
    expect(deepseekAdapter.getTitle(ctx)).toBe('北京通勤ADV踏板推荐');
  });

  it('可见窗口内解析出用户与助手消息', () => {
    const nodes = deepseekAdapter.getMessageNodes(ctx);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    const raws = nodes
      .map((n) => deepseekAdapter.parseMessage(n, ctx))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const roles = raws.map((r) => r.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const user = raws.find((r) => r.role === 'user');
    expect(user?.text).toContain('北京通勤');
    // 助手正文不应混入思考过程
    const asst = raws.find((r) => r.role === 'assistant');
    expect(asst?.text).not.toContain('我将同时进行多项搜索');
    expect(deepseekAdapter.isStreaming(ctx)).toBe(false);
  });

  it('滚动容器是包含虚拟列表的 ds-scroll-area', () => {
    const sc = deepseekAdapter.getScrollContainer(ctx);
    expect(sc).not.toBeNull();
    expect(sc!.className).toContain('ds-scroll-area');
  });

  it('diagnose ok', () => {
    expect(deepseekAdapter.diagnose(ctx).status).toBe('ok');
  });
});

describe('真实样例 → Markdown 导出（端到端）', () => {
  it('Claude 样例解析 → merge → Markdown 结构正确', async () => {
    const { mergeSnapshot } = await import('@core/merge/merge-snapshot');
    const { conversationToMarkdown } = await import('@core/export/markdown');
    const html = FIX('claude-chat.html');
    const doc = docOf(html);
    const ctx = makeCtx('https://claude.ai/chat/e36864b2-733a-4877-a152-37381e5eac2c', doc);
    const raws = claudeAdapter
      .getMessageNodes(ctx)
      .map((n) => claudeAdapter.parseMessage(n, ctx))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const convId = 'claude:aaaa1111bbbb:e36864b2-733a-4877-a152-37381e5eac2c';
    const out = await mergeSnapshot({
      conversationId: convId,
      existing: [],
      raws,
      now: 1730000000000,
      adapterVersion: claudeAdapter.version,
    });
    const conv = {
      id: convId,
      platform: 'claude' as const,
      accountKey: 'aaaa1111bbbb',
      accountLabel: 'T***',
      platformConversationId: 'e36864b2-733a-4877-a152-37381e5eac2c',
      title: claudeAdapter.getTitle(ctx)!,
      url: ctx.url.href,
      createdAt: 1730000000000,
      updatedAt: 1730000000000,
      lastSyncedAt: 1730000000000,
      messageCount: out.all.length,
      adapterVersion: claudeAdapter.version,
      source: 'url' as const,
      urlHistory: [],
    };
    const md = conversationToMarkdown(conv, out.all);
    expect(md).toContain('platform: claude');
    expect(md).toContain('account: T***');
    expect(md).toContain('# 油车与电车生命周期成本对比');
    expect(md).toContain('## 用户');
    expect(md).toContain('## 助手');
    expect(md).toContain('15 万元');
    expect(md).not.toContain('data-archive-image');
  });
});
