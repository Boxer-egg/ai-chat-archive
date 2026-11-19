/** OpenAI 官方 conversations.json 格式转换（core/export/openai.ts） */
import { describe, expect, it } from 'vitest';
import { conversationToOpenAI } from '@core/export/openai';
import type { Conversation, Message } from '@core/types';

const conv: Conversation = {
  id: 'chatgpt:aaaa:p1',
  platform: 'chatgpt',
  accountKey: 'aaaa',
  accountLabel: '账***',
  platformConversationId: 'p1',
  title: '测试会话',
  url: 'https://chatgpt.com/c/p1',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  lastSyncedAt: 1_700_000_100_000,
  messageCount: 2,
  adapterVersion: 't',
  source: 'url',
  urlHistory: [],
};

function msg(i: number, role: 'user' | 'assistant', text: string, extra: Partial<Message> = {}): Message {
  return {
    id: `chatgpt:aaaa:p1#m${i}`,
    conversationId: conv.id,
    msgKey: `p:u${i}:${role}`,
    role,
    contentText: text,
    order: (i + 1) * 1024,
    fingerprint: `f${i}`,
    contentHash: `h${i}`,
    status: 'complete',
    savedAt: 1_700_000_000_000 + i * 1000,
    updatedAt: 1_700_000_000_000 + i * 1000,
    adapterVersion: 't',
    ...extra,
  };
}

describe('conversationToOpenAI（OpenAI 官方 conversations.json 兼容）', () => {
  const messages = [
    msg(0, 'user', '问题', { timestamp: 1_700_000_000_500 }),
    msg(1, 'assistant', '回答', { model: 'gpt-4o' }),
  ];
  const out = conversationToOpenAI(conv, messages);

  it('顶层字段：id 用平台会话 ID，时间为秒级浮点', () => {
    expect(out.id).toBe('p1');
    expect(out.title).toBe('测试会话');
    expect(out.create_time).toBe(1_700_000_000);
    expect(out.update_time).toBe(1_700_000_100);
    expect(out.moderation_results).toEqual([]);
  });

  it('mapping 为单链：root（message 为 null）→ m0 → m1，current_node 指向末尾', () => {
    const ids = Object.keys(out.mapping);
    expect(ids).toHaveLength(3);
    const root = out.mapping['p1-root'];
    expect(root.message).toBeNull();
    expect(root.parent).toBeNull();
    expect(root.children).toHaveLength(1);

    const n0 = out.mapping['p1-node-0000'];
    const n1 = out.mapping['p1-node-0001'];
    expect(n0.parent).toBe('p1-root');
    expect(n0.children).toEqual(['p1-node-0001']);
    expect(n1.parent).toBe('p1-node-0000');
    expect(n1.children).toEqual([]);
    expect(out.current_node).toBe('p1-node-0001');
  });

  it('message 结构与官方格式对齐：author/content/时间/model', () => {
    const m0 = out.mapping['p1-node-0000'].message!;
    expect(m0.author.role).toBe('user');
    expect(m0.content).toEqual({ content_type: 'text', parts: ['问题'] });
    expect(m0.create_time).toBe(1_700_000_000.5); // 平台时间戳优先，秒级
    const m1 = out.mapping['p1-node-0001'].message!;
    expect(m1.model).toBe('gpt-4o');
    expect(m0.model).toBeUndefined(); // 无模型字段则不输出
  });

  it('draft 被排除；空会话 current_node 指向 root', () => {
    const draft = msg(2, 'assistant', '草稿', { status: 'draft' });
    const out2 = conversationToOpenAI(conv, [...messages, draft]);
    expect(Object.keys(out2.mapping)).toHaveLength(3);

    const empty = conversationToOpenAI(conv, []);
    expect(empty.current_node).toBe('p1-root');
    expect(empty.mapping['p1-root'].children).toEqual([]);
  });

  it('确定性：同一输入生成完全一致的输出（幂等）', () => {
    expect(conversationToOpenAI(conv, messages)).toEqual(out);
  });
});
