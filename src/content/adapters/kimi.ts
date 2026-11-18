/**
 * Kimi 适配器（kimi.com / www.kimi.com / kimi.moonshot.cn）。
 * ✅ 已实测校正（2026-10-31，保存的完整会话页，Vue 应用）：
 * - 消息列表：.message-list-container；消息段：.segment.segment-user / .segment.segment-assistant
 * - 用户正文：.segment-content（需剔除 .segment-user-action-row 的"编辑/复制/分享"）
 * - 助手正文：.markdown-container（toolcall 展开内容）优先，兜底 .segment-content-box
 * - 无消息 ID → 指纹去重路径；账号：侧边栏 [data-testid="sidebar-user-menu-trigger"]（昵称）
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
    selectors: ['.message-list-container'],
    required: true,
  },
  segment: {
    name: 'message-segment',
    selectors: ['.segment.segment-user, .segment.segment-assistant'],
    required: true,
  },
  userContent: {
    name: 'user-content',
    selectors: ['.segment-content'],
  },
  assistantMd: {
    name: 'assistant-markdown',
    // 实测：段内有两个 markdown-container——.toolcall-content-text 是工具调用的内部分析
    // （英文思考过程），真正回复是不带 toolcall 类的那个
    selectors: ['.markdown-container'],
  },
  assistantBox: {
    name: 'assistant-box',
    selectors: ['.segment-content-box'],
  },
  account: {
    name: 'account',
    selectors: ['[data-testid="sidebar-user-menu-trigger"]'],
  },
} satisfies Record<string, SelectorSpec>;

function roleOf(segment: Element): Role | null {
  const cls = segment.className.toString();
  if (cls.includes('segment-user')) return 'user';
  if (cls.includes('segment-assistant')) return 'assistant';
  return null;
}

/** 克隆后剔除操作行与卡片容器，避免"编辑/复制/分享"等噪音 */
function clean(segment: Element): { text: string; html?: string } {
  const clone = segment.cloneNode(true) as Element;
  for (const sel of ['.segment-user-action-row', '.segment-user-actions', '.okc-cards-container', '.segment-assistant-action-row', '[class*=action-row]']) {
    for (const n of Array.from(clone.querySelectorAll(sel))) n.remove();
  }
  return { text: extractText(clone), html: extractHtml(clone) };
}

export const kimiAdapter: PlatformAdapter = {
  id: 'kimi',
  version: '1.0.0-verified-2026-10-31',
  displayName: 'Kimi',
  hosts: ['kimi.com', 'www.kimi.com', 'kimi.moonshot.cn'],

  match(url: URL): boolean {
    return (
      /(^|\.)kimi\.com$/.test(url.hostname) || url.hostname === 'kimi.moonshot.cn'
    ) && idFromPath(url, /^\/chat\/([0-9a-f-]{8,})/i) !== null;
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
    if (/^1[3-9]\d{9}$/.test(text)) return { rawId: text, label: text, source: 'dom-id' };
    return { rawId: `kimi-user:${text}`, label: text, source: 'avatar' };
  },

  getTitle(ctx: AdapterContext): string | null {
    const t = ctx.document.querySelector('title')?.textContent?.trim();
    if (t) return t.replace(/\s*-\s*Kimi\s*$/, '');
    return null;
  },

  getMessageRoot(ctx: AdapterContext): Element | null {
    const misses: string[] = [];
    return pick(ctx.document, S.messageList, misses);
  },

  getMessageNodes(ctx: AdapterContext): Element[] {
    // 实测：.segment 与 .message-list-container 是兄弟节点（容器仅作定位），
    // 因此从 document 范围取段，根容器只用于 MutationObserver
    return Array.from(
      ctx.document.querySelectorAll('.segment.segment-user, .segment.segment-assistant'),
    );
  },

  parseMessage(node: Element, ctx: AdapterContext, frame?: ParseFrame): RawMessage | null {
    const nodes = frame?.nodes ?? this.getMessageNodes(ctx);
    const index = frame?.index ?? nodes.indexOf(node);
    const role = roleOf(node);
    if (!role) return null;
    if (role === 'assistant') {
      // 跳过 toolcall 容器（思考过程/工具分析），取真正的回复。
      // 注意：回复容器自身在 DOM 里也可能位于 toolcall 流程的祖先下，
      // 所以按"元素自身的 class 是否带 toolcall"判别，而不是祖先。
      const md = Array.from(node.querySelectorAll('.markdown-container')).find(
        (el) => !el.className.toString().includes('toolcall'),
      );
      if (md) {
        return {
          role,
          text: extractText(md),
          html: extractHtml(md),
          domIndex: index,
          streaming: index === nodes.length - 1 && this.isStreaming(ctx),
        };
      }
    }
    const { text, html } = clean(node);
    return { role, text, html, domIndex: index };
  },

  isStreaming(ctx: AdapterContext): boolean {
    return Array.from(ctx.document.querySelectorAll('button, [class*=loading]')).some((b) =>
      /停止|stop/i.test(`${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`),
    );
  },

  getScrollContainer(ctx: AdapterContext): HTMLElement | null {
    const root = this.getMessageRoot(ctx);
    if (!root) return null;
    return root instanceof HTMLElement && /auto|scroll/.test(getComputedStyle(root).overflowY)
      ? root
      : findScrollable(root);
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
