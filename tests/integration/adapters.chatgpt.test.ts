// @vitest-environment jsdom
/**
 * ChatGPT 真实 DOM 验证（2026-11-02 DevTools 导出的水合后 <main>，新版 app-shell UI）。
 * 完整页面样例（chatgpt-chat.html）只用于 match/标题/账号；消息结构以导出的 <main> 为准。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatgptAdapter } from '../../src/content/adapters/chatgpt';
import { makeCtx } from '../../src/content/adapters/base';
import { mergeSnapshot } from '@core/merge/merge-snapshot';

const FIX = (name: string) => readFileSync(join(__dirname, 'fixtures/real', name), 'utf-8');
const docOf = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('ChatGPT 导出 DOM（消息结构已实测）', () => {
  const ctx = makeCtx(
    'https://chatgpt.com/c/6abd1314-6c44-83ea-9ed7-69a23e89bda0',
    docOf(FIX('chatgpt-main.html')),
  );

  it('8 条消息：4 用户 + 4 助手，文档顺序正确', () => {
    const nodes = chatgptAdapter.getMessageNodes(ctx);
    expect(nodes).toHaveLength(8);
    const raws = nodes.map((n) => chatgptAdapter.parseMessage(n, ctx)).filter((r) => r !== null);
    const roles = raws.map((r) => r!.role);
    expect(roles.filter((r) => r === 'user')).toHaveLength(4);
    expect(roles.filter((r) => r === 'assistant')).toHaveLength(4);
    // 顺序应为 user/assistant 交替
    expect(roles.slice(0, 4)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(raws[0]!.text).toBe('哥德巴赫猜想');
    expect(raws[1]!.text).toContain('Goldbach');
    expect(chatgptAdapter.diagnose(ctx).status).toBe('ok');
  });

  it('滚动容器是 thread-scroll-container', () => {
    const sc = chatgptAdapter.getScrollContainer(ctx);
    expect(sc?.className.toString()).toContain('thread-scroll-container');
  });

  it('样例 → merge：幂等', async () => {
    const raws = chatgptAdapter
      .getMessageNodes(ctx)
      .map((n) => chatgptAdapter.parseMessage(n, ctx))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const convId = 'chatgpt:aaaa1111bbbb:6abd1314-6c44-83ea-9ed7-69a23e89bda0';
    const first = await mergeSnapshot({ conversationId: convId, existing: [], raws, now: 1, adapterVersion: chatgptAdapter.version });
    const second = await mergeSnapshot({ conversationId: convId, existing: first.all, raws: raws.map((r) => ({ ...r })), now: 2, adapterVersion: chatgptAdapter.version });
    expect(second.inserted).toBe(0);
    expect(second.all).toHaveLength(8);
  });
});

describe('ChatGPT 完整页面样例（match/标题/账号）', () => {
  const ctx = makeCtx('https://chatgpt.com/c/6abd1314-6c44-83ea-9ed7-69a23e89bda0', docOf(FIX('chatgpt-chat.html')));

  it('match + 会话 ID + 标题 + 账号', () => {
    expect(chatgptAdapter.match(ctx.url)).toBe(true);
    expect(chatgptAdapter.getConversation(ctx)?.platformConversationId).toBe('6abd1314-6c44-83ea-9ed7-69a23e89bda0');
    expect(chatgptAdapter.getTitle(ctx)).toBe('解释哥德巴赫猜想');
    expect(chatgptAdapter.getAccountHint(ctx)?.rawId).toBe('user-0000000000000000000000a');
  });
});
