// @vitest-environment jsdom
/**
 * 消息级模型字段：提取 → 落库 → 导出（借鉴 socketteer 的模型保留思路）
 */
import { describe, expect, it } from 'vitest';
import { extractModelHint } from '../../src/content/adapters/base';
import { mergeSnapshot } from '@core/merge/merge-snapshot';
import { conversationToMarkdown } from '@core/export/markdown';
import type { Conversation, RawMessage } from '@core/types';

describe('extractModelHint', () => {
  it('data-model 属性优先（自身或祖先）', () => {
    const doc = new DOMParser().parseFromString(
      '<div data-model="claude-sonnet-4-5"><div><span>回答</span></div></div>',
      'text/html',
    );
    expect(extractModelHint(doc.querySelector('span')!)).toBe('claude-sonnet-4-5');
  });

  it('aria-label 正则兜底', () => {
    const doc = new DOMParser().parseFromString(
      '<div><button aria-label="Selected model gpt-4o">▾</button></div>',
      'text/html',
    );
    expect(extractModelHint(doc.body)).toBe('gpt-4o');
  });

  it('无标识时返回 undefined', () => {
    const doc = new DOMParser().parseFromString('<div><p>plain text</p></div>', 'text/html');
    expect(extractModelHint(doc.querySelector('p')!)).toBeUndefined();
  });
});

describe('model 字段全管线', () => {
  const CONV = 'kimi:aaaa:conv-1';
  const raws: RawMessage[] = [
    { role: 'user', text: '问题', domIndex: 0 },
    { role: 'assistant', text: '回答', domIndex: 1, model: 'kimi-k2' },
  ];
  const conv = (title: string): Conversation => ({
    id: CONV,
    platform: 'kimi',
    accountKey: 'aaaa',
    accountLabel: '账***',
    platformConversationId: 'conv-1',
    title,
    url: 'https://www.kimi.com/chat/conv-1',
    createdAt: 1,
    updatedAt: 2,
    lastSyncedAt: 2,
    messageCount: 2,
    adapterVersion: 't',
    source: 'url',
    urlHistory: [],
  });

  it('RawMessage.model 落库保留，更新时新值优先、无新值保留旧值', async () => {
    const out = await mergeSnapshot({ conversationId: CONV, existing: [], raws, now: 1, adapterVersion: 't' });
    expect(out.all[1].model).toBe('kimi-k2');

    const same = await mergeSnapshot({ conversationId: CONV, existing: out.all, raws: raws.map((r) => ({ ...r })), now: 2, adapterVersion: 't' });
    expect(same.all[1].model).toBe('kimi-k2');

    const upgraded = await mergeSnapshot({
      conversationId: CONV,
      existing: out.all,
      raws: [raws[0], { ...raws[1], model: 'kimi-k3' }],
      now: 3,
      adapterVersion: 't',
    });
    expect(upgraded.all[1].model).toBe('kimi-k3');
  });

  it('Markdown front matter 带最近一条模型标识；无模型则不输出该行', async () => {
    const out = await mergeSnapshot({ conversationId: CONV, existing: [], raws, now: 1, adapterVersion: 't' });
    expect(conversationToMarkdown(conv('有模型'), out.all)).toContain('model: kimi-k2');

    const noModel = await mergeSnapshot({
      conversationId: CONV,
      existing: [],
      raws: [{ role: 'user', text: 'hi', domIndex: 0 }],
      now: 1,
      adapterVersion: 't',
    });
    expect(conversationToMarkdown(conv('无模型'), noModel.all)).not.toContain('\nmodel:');
  });
});
