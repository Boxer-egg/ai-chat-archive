/**
 * Claude 适配器（claude.ai）。
 * ✅ 已实测校正（2026-10-31，Edge 保存的完整会话页，data-build-id=5a3156f9be）：
 * - 消息列表：[data-testid="transcript-list"]；消息行：[data-testid="transcript-row"]
 * - 角色：行的 data-perf-row="human"|"assistant"
 * - 稳定消息 ID：行内 [data-turn-key]（assistant 带 "-hub-reply" 后缀，剥掉即与用户同 UUID）
 * - 流式：data-perf-row-streaming / data-is-streaming
 * - 账号：[data-testid="user-menu-button"]（示例文本 "Tars·Free"，无邮箱时按名称处理）
 * 若 Claude 改版导致 misses，按 docs/adapter-guide.md 局部修复本文件。
 */
import type {
  AccountHintInput,
  AdapterContext,
  AdapterDiagnosis,
  ConversationRef,
  ParseFrame,
  PlatformAdapter,
  RawMessage,
  Role,
} from '../../core/types';
import { extractHtml, extractText, findScrollable, idFromPath } from './base';
import { pick, type SelectorSpec } from './selectors';

const S = {
  messageList: {
    name: 'message-list',
    selectors: ['[data-testid="transcript-list"]'],
    required: true,
  },
  messageRow: {
    name: 'message-row',
    selectors: ['[data-testid="transcript-row"]'],
    required: true,
  },
  userContent: {
    name: 'user-content',
    selectors: ['[data-testid="user-message"]'],
  },
  assistantContent: {
    name: 'assistant-content',
    selectors: ['[data-testid="assistant-message"]'],
  },
  account: {
    name: 'account',
    selectors: ['[data-testid="user-menu-button"]'],
  },
} satisfies Record<string, SelectorSpec>;

/** 助手消息里的非正文节点（克隆后剔除） */
const ASSISTANT_NOISE = [
  '.sr-only',
  '[data-cds="TurnStatus"]',
  '[data-testid="response-status-announcer"]',
  '[data-testid="message-actions"]',
  '[data-cds="RelativeTime"]',
  // Artifact 预览浮层（position:fixed 的卡片，含 visualize 等占位文本）
  '.fixed',
  // 次级元信息（Artifact 使用状态芯片等 muted 文本）
  '.text-muted-as-secondary',
].join(', ');

function rowRole(row: Element): Role | null {
  const perf = row.getAttribute('data-perf-row');
  if (perf === 'human') return 'user';
  if (perf === 'assistant') return 'assistant';
  if (row.querySelector('[data-testid="user-message"]')) return 'user';
  if (row.querySelector('[data-testid="assistant-message"]')) return 'assistant';
  return null;
}

function turnKeyOf(row: Element, role: Role): string | undefined {
  const scope =
    role === 'user'
      ? row.querySelector('[data-testid="user-message"]')
      : row.querySelector('[data-testid="assistant-message"]');
  const key = scope?.getAttribute('data-turn-key') ?? scope?.closest('[data-turn-key]')?.getAttribute('data-turn-key');
  if (!key) return undefined;
  return key.replace(/-hub-reply$/, '');
}

function cleanExtract(el: Element, noiseSelector: string): { text: string; html?: string } {
  const clone = el.cloneNode(true) as Element;
  for (const n of Array.from(clone.querySelectorAll(noiseSelector))) n.remove();
  return { text: extractText(clone), html: extractHtml(clone) };
}

export const claudeAdapter: PlatformAdapter = {
  id: 'claude',
  version: '1.0.0-verified-2026-10-31',
  displayName: 'Claude',
  hosts: ['claude.ai'],

  match(url: URL): boolean {
    return url.hostname === 'claude.ai' && idFromPath(url, /^\/chat\/([0-9a-f-]{8,})/i) !== null;
  },

  getConversation(ctx: AdapterContext): ConversationRef | null {
    const id = idFromPath(ctx.url, /^\/chat\/([0-9a-f-]{8,})/i);
    return id ? { platformConversationId: id, source: 'url' } : null;
  },

  getAccountHint(ctx: AdapterContext): AccountHintInput | null {
    const misses: string[] = [];
    const el = pick(ctx.document, S.account, misses);
    const text = el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!text) return null;
    if (text.includes('@')) return { rawId: text, label: text, source: 'email' };
    // "Tars·Free" 这类名称+套餐文本：取名称段作为标识
    const name = text.split('·')[0]?.trim() || text;
    return { rawId: `claude-user:${name}`, label: name, source: 'avatar' };
  },

  getTitle(ctx: AdapterContext): string | null {
    // 实测：<title>为 "会话名 - Claude"；侧边栏高亮项作兜底
    const t = ctx.document.querySelector('title')?.textContent?.trim();
    if (t) return t.replace(/\s*-\s*Claude\s*$/, '');
    const el = ctx.document.querySelector('[data-testid="sidebar-recents"] [aria-current], [data-testid="sidebar-recents"] a');
    return el?.textContent?.trim() || null;
  },

  getMessageRoot(ctx: AdapterContext): Element | null {
    const misses: string[] = [];
    return pick(ctx.document, S.messageList, misses);
  },

  getMessageNodes(ctx: AdapterContext): Element[] {
    const misses: string[] = [];
    const root = pick(ctx.document, S.messageList, misses);
    return root ? Array.from(root.querySelectorAll('[data-testid="transcript-row"]')) : [];
  },

  parseMessage(node: Element, ctx: AdapterContext, frame?: ParseFrame): RawMessage | null {
    const nodes = frame?.nodes ?? this.getMessageNodes(ctx);
    const index = frame?.index ?? nodes.indexOf(node);
    const role = rowRole(node);
    if (!role) return null;
    const streaming =
      node.getAttribute('data-perf-row-streaming') === 'true' ||
      node.querySelector('[data-is-streaming="true"]') !== null;
    const base = {
      role,
      domIndex: index,
      platformMessageId: turnKeyOf(node, role),
      streaming,
    };
    if (role === 'user') {
      const content = node.querySelector('[data-testid="user-message"]');
      if (!content) return null;
      return { ...base, text: extractText(content), html: extractHtml(content) };
    }
    const content = node.querySelector('[data-testid="assistant-message"]');
    if (!content) return null;
    const { text, html } = cleanExtract(content, ASSISTANT_NOISE);
    return { ...base, text, html };
  },

  isStreaming(ctx: AdapterContext): boolean {
    return (
      ctx.document.querySelector('[data-perf-row-streaming="true"], [data-is-streaming="true"]') !== null ||
      Array.from(ctx.document.querySelectorAll('button')).some((b) =>
        /停止|stop/i.test(`${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`),
      )
    );
  },

  getScrollContainer(ctx: AdapterContext): HTMLElement | null {
    const root = this.getMessageRoot(ctx);
    return root ? findScrollable(root) : null;
  },

  diagnose(ctx: AdapterContext): AdapterDiagnosis {
    const misses: string[] = [];
    pick(ctx.document, S.messageList, misses);
    const nodes = this.getMessageNodes(ctx);
    const failures = nodes.filter((n, i) => this.parseMessage(n, ctx, { nodes, index: i }) === null).length;
    return {
      status: nodes.length === 0 ? 'broken' : failures > 0 ? 'degraded' : 'ok',
      messageCount: nodes.length,
      misses,
      notes: failures ? `${failures} 条解析失败` : undefined,
    };
  },
};
