/**
 * Grok 适配器（grok.com）。
 * ✅ 已实测校正（2026-10-31，保存的完整会话页）：
 * - 滚动容器/列表：[data-testid="chat-transcript-scroller"]
 * - 消息气泡：[data-testid="user-message"] / [data-testid="assistant-message"]（无消息 ID → 指纹去重）
 * - 助手噪音：.sr-only、.thinking-container（思考过程）、.not-prose（"Worked for 14s"状态条）、[class*="print:hidden"]（操作栏）
 * - 账号：保存页未渲染菜单 → 默认 default 桶
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
import { extractHtml, extractText, idFromPath } from './base';
import { pick, type SelectorSpec } from './selectors';

const S = {
  scroller: {
    name: 'message-list',
    selectors: ['[data-testid="chat-transcript-scroller"]'],
    required: true,
  },
  bubbles: {
    name: 'message-bubble',
    selectors: ['[data-testid="user-message"], [data-testid="assistant-message"]'],
    required: true,
  },
} satisfies Record<string, SelectorSpec>;

const ASSISTANT_NOISE = '.sr-only, .thinking-container, .not-prose, [class*="print:hidden"]';

function roleOf(el: Element): Role | null {
  const t = el.getAttribute('data-testid');
  if (t === 'user-message') return 'user';
  if (t === 'assistant-message') return 'assistant';
  return null;
}

export const grokAdapter: PlatformAdapter = {
  id: 'grok',
  version: '1.0.0-verified-2026-10-31',
  displayName: 'Grok',
  hosts: ['grok.com'],

  match(url: URL): boolean {
    return url.hostname === 'grok.com' && idFromPath(url, /^\/c\/([0-9a-f-]{8,})/i) !== null;
  },

  getConversation(ctx: AdapterContext): ConversationRef | null {
    const id = idFromPath(ctx.url, /^\/c\/([0-9a-f-]{8,})/i);
    return id ? { platformConversationId: id, source: 'url' } : null;
  },

  getAccountHint(_ctx: AdapterContext): AccountHintInput | null {
    return null; // 保存页未渲染账号菜单；登录态下的选择器待补（落 default 桶）
  },

  getTitle(ctx: AdapterContext): string | null {
    const t = ctx.document.querySelector('title')?.textContent?.trim();
    if (t) return t.replace(/\s*-\s*Grok\s*$/, '');
    return null;
  },

  getMessageRoot(ctx: AdapterContext): Element | null {
    const misses: string[] = [];
    return pick(ctx.document, S.scroller, misses);
  },

  getMessageNodes(ctx: AdapterContext): Element[] {
    const root = this.getMessageRoot(ctx);
    return root
      ? Array.from(
          root.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]'),
        )
      : [];
  },

  parseMessage(node: Element, ctx: AdapterContext, frame?: ParseFrame): RawMessage | null {
    const nodes = frame?.nodes ?? this.getMessageNodes(ctx);
    const index = frame?.index ?? nodes.indexOf(node);
    const role = roleOf(node);
    if (!role) return null;
    if (role === 'assistant') {
      const clone = node.cloneNode(true) as Element;
      for (const n of Array.from(clone.querySelectorAll(ASSISTANT_NOISE))) n.remove();
      return {
        role,
        text: extractText(clone),
        html: extractHtml(clone),
        domIndex: index,
        streaming: index === nodes.length - 1 && this.isStreaming(ctx),
      };
    }
    return { role, text: extractText(node), html: extractHtml(node), domIndex: index };
  },

  isStreaming(ctx: AdapterContext): boolean {
    return Array.from(ctx.document.querySelectorAll('button')).some((b) =>
      /停止|stop/i.test(`${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('data-testid') ?? ''}`),
    );
  },

  getScrollContainer(ctx: AdapterContext): HTMLElement | null {
    const root = this.getMessageRoot(ctx);
    return root instanceof HTMLElement ? root : null;
  },

  diagnose(ctx: AdapterContext): AdapterDiagnosis {
    const misses: string[] = [];
    pick(ctx.document, S.scroller, misses);
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
