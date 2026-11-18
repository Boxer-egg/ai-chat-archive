/**
 * 搜索（技术方案 §12.1）：子串 AND 匹配 + 高亮片段。
 * 纯函数，可单测；扫描方（SW）用游标遍历喂数据。
 */
import type { Conversation, Message } from './types';
import type { SearchHitConversation, SearchRequest } from './protocol';
import { LIMITS } from '../shared/constants';

export function normalizeQuery(q: string): string[] {
  return q
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

export function snippetAround(text: string, keyword: string, radius = 60): string {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + keyword.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export interface ScanInput {
  conversations: Conversation[];
  messages: Message[]; // 按 conversationId 分组顺序无关
  request: SearchRequest;
}

/** 在内存数据集上执行搜索（SW 端先收集再调用；量大了再换游标直扫） */
export function searchMessages(input: ScanInput): { hits: SearchHitConversation[]; total: number } {
  const keywords = normalizeQuery(input.request.query);
  if (keywords.length === 0) return { hits: [], total: 0 };
  const limit = input.request.limit ?? LIMITS.SEARCH_RESULT_MAX;

  const byConv = new Map<string, Message[]>();
  for (const m of input.messages) {
    if (m.status !== 'complete') continue;
    const arr = byConv.get(m.conversationId) ?? [];
    arr.push(m);
    byConv.set(m.conversationId, arr);
  }

  const convById = new Map(input.conversations.map((c) => [c.id, c]));
  const hits: SearchHitConversation[] = [];
  let total = 0;

  for (const [conversationId, msgs] of byConv) {
    if (hits.length >= 40) break; // 命中会话数上限
    const conv = convById.get(conversationId);
    if (!conv) continue;
    if (input.request.platform && conv.platform !== input.request.platform) continue;
    if (input.request.accountKey && conv.accountKey !== input.request.accountKey) continue;

    const titleHit = keywords.every((k) => conv.title.toLowerCase().includes(k));
    const matched = msgs
      .filter((m) => keywords.every((k) => m.contentText.toLowerCase().includes(k)))
      .sort((a, b) => a.order - b.order)
      .slice(0, 3)
      .map((m) => ({
        id: m.id,
        role: m.role,
        order: m.order,
        snippet: snippetAround(m.contentText, keywords[0]),
      }));

    if (!titleHit && matched.length === 0) continue;
    total += matched.length;
    hits.push({
      conversationId,
      title: conv.title,
      platform: conv.platform,
      accountLabel: conv.accountLabel,
      url: conv.url,
      updatedAt: conv.updatedAt,
      messages: matched,
    });
    if (total >= limit) break;
  }

  // 标题命中的排前面
  hits.sort((a, b) => {
    const at = keywords.every((k) => a.title.toLowerCase().includes(k)) ? 0 : 1;
    const bt = keywords.every((k) => b.title.toLowerCase().includes(k)) ? 0 : 1;
    return at - bt || b.updatedAt - a.updatedAt;
  });
  return { hits, total };
}
