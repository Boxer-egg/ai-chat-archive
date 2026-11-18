// @vitest-environment jsdom
/**
 * Kimi / Grok 真实页面样例的适配器验证测试（2026-10-31 保存的完整会话页）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kimiAdapter } from '../../src/content/adapters/kimi';
import { grokAdapter } from '../../src/content/adapters/grok';
import { makeCtx } from '../../src/content/adapters/base';
import { mergeSnapshot } from '@core/merge/merge-snapshot';

const FIX = (name: string) => readFileSync(join(__dirname, 'fixtures/real', name), 'utf-8');
const docOf = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('Kimi 真实样例', () => {
  const html = FIX('kimi-chat.html');
  const doc = docOf(html);
  const ctx = makeCtx('https://www.kimi.com/chat/1a191987-8fb2-8aad-8000-094650f7c061', doc);

  it('match + 会话 ID + 标题', () => {
    expect(kimiAdapter.match(ctx.url)).toBe(true);
    expect(kimiAdapter.getConversation(ctx)?.platformConversationId).toBe('1a191987-8fb2-8aad-8000-094650f7c061');
    expect(kimiAdapter.getTitle(ctx)).toBe('ROS 版本海报');
  });

  it('12 个消息段：6 用户 + 6 助手，角色正确', () => {
    const nodes = kimiAdapter.getMessageNodes(ctx);
    expect(nodes).toHaveLength(12);
    const raws = nodes.map((n) => kimiAdapter.parseMessage(n, ctx)).filter((r) => r !== null);
    expect(raws.filter((r) => r!.role === 'user')).toHaveLength(6);
    expect(raws.filter((r) => r!.role === 'assistant')).toHaveLength(6);
    // 助手正文应是真实回复（2026-11-03 回归：曾误抓 toolcall 思考过程）
    const asst = raws.filter((r) => r!.role === 'assistant');
    expect(asst.every((r) => r!.text.length > 10)).toBe(true);
    expect(asst[0]!.text).toContain('结论');
    expect(asst[0]!.text).not.toContain('The user uploaded');
    expect(kimiAdapter.diagnose(ctx).status).toBe('ok');
  });

  it('用户正文不含"编辑/复制/分享"操作噪音', () => {
    const nodes = kimiAdapter.getMessageNodes(ctx);
    const texts = nodes
      .map((n) => kimiAdapter.parseMessage(n, ctx))
      .filter((r) => r?.role === 'user')
      .map((r) => r!.text);
    for (const t of texts) {
      expect(t).not.toMatch(/^(编辑|复制|分享)\s*(编辑|复制|分享)*$/);
    }
  });

  it('账号线索：侧边栏用户菜单（昵称）', () => {
    const hint = kimiAdapter.getAccountHint(ctx);
    expect(hint).not.toBeNull();
    expect(hint!.label).toBe('抓紧开第一个店铺');
  });

  it('样例 → merge：幂等（重跑零新增）', async () => {
    const raws = kimiAdapter
      .getMessageNodes(ctx)
      .map((n) => kimiAdapter.parseMessage(n, ctx))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const convId = 'kimi:aaaa1111bbbb:1a191987-8fb2-8aad-8000-094650f7c061';
    const first = await mergeSnapshot({ conversationId: convId, existing: [], raws, now: 1, adapterVersion: kimiAdapter.version });
    const second = await mergeSnapshot({ conversationId: convId, existing: first.all, raws: raws.map((r) => ({ ...r })), now: 2, adapterVersion: kimiAdapter.version });
    expect(second.inserted).toBe(0);
    expect(second.all.length).toBe(first.all.length);
  });
});

describe('Grok 真实样例', () => {
  const html = FIX('grok-chat.html');
  const doc = docOf(html);
  const ctx = makeCtx('https://grok.com/c/85a6bb56-bf7f-4d9f-a433-4417db41dd52', doc);

  it('match + 会话 ID + 标题', () => {
    expect(grokAdapter.match(ctx.url)).toBe(true);
    expect(grokAdapter.getConversation(ctx)?.platformConversationId).toBe('85a6bb56-bf7f-4d9f-a433-4417db41dd52');
    expect(grokAdapter.getTitle(ctx)).toBe('状态机定义与MCU PLC设备关系');
  });

  it('4 轮对话：4 用户 + 4 助手，正文无状态噪音', () => {
    const nodes = grokAdapter.getMessageNodes(ctx);
    expect(nodes).toHaveLength(8);
    const raws = nodes.map((n) => grokAdapter.parseMessage(n, ctx)).filter((r) => r !== null);
    expect(raws.filter((r) => r!.role === 'user')).toHaveLength(4);
    expect(raws.filter((r) => r!.role === 'assistant')).toHaveLength(4);
    const asst = raws.find((r) => r!.role === 'assistant')!;
    expect(asst.text).toContain('状态机');
    // "Worked for 14s" 状态条与思考过程应被剔除
    expect(asst.text).not.toMatch(/Worked for/);
    expect(asst.text).not.toContain('GrokWorked');
    expect(grokAdapter.diagnose(ctx).status).toBe('ok');
  });

  it('滚动容器是 chat-transcript-scroller', () => {
    const sc = grokAdapter.getScrollContainer(ctx);
    expect(sc?.getAttribute('data-testid')).toBe('chat-transcript-scroller');
  });

  it('样例 → merge：幂等', async () => {
    const raws = grokAdapter
      .getMessageNodes(ctx)
      .map((n) => grokAdapter.parseMessage(n, ctx))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const convId = 'grok:aaaa1111bbbb:85a6bb56-bf7f-4d9f-a433-4417db41dd52';
    const first = await mergeSnapshot({ conversationId: convId, existing: [], raws, now: 1, adapterVersion: grokAdapter.version });
    const second = await mergeSnapshot({ conversationId: convId, existing: first.all, raws: raws.map((r) => ({ ...r })), now: 2, adapterVersion: grokAdapter.version });
    expect(second.inserted).toBe(0);
  });
});

describe('ChatGPT 完整保存页（新版 UI 选择器兼容）', () => {
  const html = FIX('chatgpt-chat.html');
  const doc = docOf(html);
  const ctx = makeCtx('https://chatgpt.com/c/6abd1314-6c44-83ea-9ed7-69a23e89bda0', doc);

  it('match + 会话 ID + 标题', async () => {
    const { chatgptAdapter } = await import('../../src/content/adapters/chatgpt');
    expect(chatgptAdapter.match(ctx.url)).toBe(true);
    expect(chatgptAdapter.getConversation(ctx)?.platformConversationId).toBe('6abd1314-6c44-83ea-9ed7-69a23e89bda0');
    expect(chatgptAdapter.getTitle(ctx)).toBe('解释哥德巴赫猜想');
  });

  it('账号标识：data-theme-user-id（已实测）', async () => {
    const { chatgptAdapter } = await import('../../src/content/adapters/chatgpt');
    const hint = chatgptAdapter.getAccountHint(ctx);
    expect(hint?.rawId).toBe('user-0000000000000000000000a');
    expect(hint?.label.length).toBeGreaterThan(0);
  });

  it('保存页同样可解析（新版 UI 类名在保存快照中可用）', async () => {
    const { chatgptAdapter } = await import('../../src/content/adapters/chatgpt');
    const d = chatgptAdapter.diagnose(ctx);
    expect(d.status).toBe('ok');
    // 注意：保存瞬间若正在切换会话，DOM 可能混入上一个会话的残留（本样例即如此）；
    // 真实运行由 MutationObserver 在会话稳定后重新采集，merge 按内容指纹去重
    expect(d.messageCount).toBeGreaterThanOrEqual(8);
  });
});
