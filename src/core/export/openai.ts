/**
 * OpenAI 官方导出格式（conversations.json）转换——让备份可被 SillyTavern 等
 * 生态工具直接读取（借鉴 pionxzh/chatgpt-exporter 的多格式导出）。
 * 我们的库是线性归档，转换为一棵单链 mapping 树（root → m0 → m1 → …）。
 * 所有 id 确定性生成（复现同一数据得到同一文件，符合项目幂等哲学）。
 */
import type { Conversation, Message } from '../types';

export interface OpenAIAuthor {
  role: string;
  name?: string | null;
  metadata: Record<string, never>;
}

export interface OpenAIMessage {
  id: string;
  author: OpenAIAuthor;
  create_time: number;
  update_time: number | null;
  content: { content_type: 'text'; parts: string[] };
  model?: string;
  metadata: Record<string, never>;
}

export interface OpenAINode {
  id: string;
  message: OpenAIMessage | null;
  parent: string | null;
  children: string[];
}

export interface OpenAIConversation {
  id: string;
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, OpenAINode>;
  moderation_results: unknown[];
  current_node: string;
}

/** node id 确定性生成：官方格式为 UUID 样式，消费方按结构读取，不校验形态 */
const nodeId = (pcid: string, i: number): string => `${pcid}-node-${String(i).padStart(4, '0')}`;
const ROOT_SUFFIX = '-root';

export function conversationToOpenAI(conv: Conversation, messages: Message[]): OpenAIConversation {
  const pcid = conv.platformConversationId;
  const ordered = messages
    .filter((m) => m.status === 'complete')
    .sort((a, b) => a.order - b.order);

  const rootId = `${pcid}${ROOT_SUFFIX}`;
  const mapping: Record<string, OpenAINode> = {};
  mapping[rootId] = {
    id: rootId,
    message: null,
    parent: null,
    children: ordered.length > 0 ? [nodeId(pcid, 0)] : [],
  };

  ordered.forEach((m, i) => {
    const id = nodeId(pcid, i);
    const message: OpenAIMessage = {
      id,
      author: { role: m.role, metadata: {} },
      create_time: (m.timestamp ?? m.savedAt) / 1000,
      update_time: null,
      content: { content_type: 'text', parts: [m.contentText] },
      ...(m.model ? { model: m.model } : {}),
      metadata: {},
    };
    mapping[id] = {
      id,
      message,
      parent: i === 0 ? rootId : nodeId(pcid, i - 1),
      children: i < ordered.length - 1 ? [nodeId(pcid, i + 1)] : [],
    };
  });

  return {
    id: pcid,
    title: conv.title,
    create_time: conv.createdAt / 1000,
    update_time: conv.updatedAt / 1000,
    mapping,
    moderation_results: [],
    current_node: ordered.length > 0 ? nodeId(pcid, ordered.length - 1) : rootId,
  };
}
