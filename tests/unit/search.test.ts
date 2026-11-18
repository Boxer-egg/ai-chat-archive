import { describe, expect, it } from 'vitest';
import { normalizeQuery, searchMessages, snippetAround } from '@core/search';
import type { Conversation, Message } from '@core/types';

const conv = (id: string, title: string, platform = 'claude', accountKey = 'k1', updatedAt = 1): Conversation => ({
  id,
  platform: platform as Conversation['platform'],
  accountKey,
  accountLabel: 'a***@x.com',
  platformConversationId: id,
  title,
  url: 'https://example.com',
  createdAt: 1,
  updatedAt,
  lastSyncedAt: 1,
  messageCount: 1,
  adapterVersion: 't',
  source: 'url',
  urlHistory: [],
});

const msg = (id: string, conversationId: string, text: string, status: 'draft' | 'complete' = 'complete'): Message => ({
  id,
  conversationId,
  msgKey: `f:${id}`,
  role: 'user',
  contentText: text,
  order: 1,
  fingerprint: id,
  contentHash: id,
  status,
  savedAt: 1,
  updatedAt: 1,
  adapterVersion: 't',
});

describe('searchMessages', () => {
  const conversations = [
    conv('c1', 'Python 数据处理', 'claude', 'k1', 100),
    conv('c2', '周末骑行计划', 'deepseek', 'k2', 200),
    conv('c3', 'Python 面试准备', 'claude', 'k1', 300),
  ];
  const messages = [
    msg('m1', 'c1', 'pandas 的 groupby 怎么用？'),
    msg('m2', 'c2', '周日去长安街骑一圈'),
    msg('m3', 'c3', 'pandas 和 polars 的区别'),
    msg('m4-draft', 'c3', 'pandas 草稿半句话', 'draft'),
  ];

  it('按内容关键词命中并返回片段', () => {
    const { hits } = searchMessages({ conversations, messages, request: { query: 'pandas' } });
    expect(hits).toHaveLength(2);
    expect(hits[0].conversationId).toBe('c3'); // 更新优先
    expect(hits[0].messages[0].snippet).toContain('pandas');
  });

  it('多关键词 AND 语义', () => {
    // 标题同时含两个词 → 命中
    const titleHit = searchMessages({ conversations, messages, request: { query: 'python 面试' } });
    expect(titleHit.hits.map((h) => h.conversationId)).toEqual(['c3']);
    // 同一消息需同时含两个词；分散在不同消息不算 → 无命中（严格 AND）
    const none = searchMessages({ conversations, messages, request: { query: 'pandas 骑行' } });
    expect(none.hits).toHaveLength(0);
    // 一个词在标题、一个在消息 → 无命中（严格 AND）
    const split = searchMessages({ conversations, messages, request: { query: 'pandas 面试' } });
    expect(split.hits).toHaveLength(0);
  });

  it('平台与账号过滤', () => {
    const { hits } = searchMessages({
      conversations,
      messages,
      request: { query: 'pandas', platform: 'claude' },
    });
    expect(hits.every((h) => h.platform === 'claude')).toBe(true);
    const byAccount = searchMessages({ conversations, messages, request: { query: 'pandas', accountKey: 'k2' } });
    expect(byAccount.hits).toHaveLength(0);
  });

  it('draft 不参与搜索', () => {
    const { hits } = searchMessages({ conversations, messages, request: { query: '草稿' } });
    expect(hits).toHaveLength(0);
  });

  it('normalizeQuery / snippetAround', () => {
    expect(normalizeQuery('  Pandas  面试 ')).toEqual(['pandas', '面试']);
    const long = 'x'.repeat(300) + '关键词' + 'y'.repeat(300);
    const snip = snippetAround(long, '关键词');
    expect(snip.startsWith('…')).toBe(true);
    expect(snip).toContain('关键词');
    expect(snip.length).toBeLessThan(160);
  });
});
