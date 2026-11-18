/**
 * DeepSeek 适配器（chat.deepseek.com）。
 * ✅ 已实测校正（2026-10-31，保存的完整会话页）：
 * - 虚拟列表：.ds-virtual-list-items（只渲染可见消息，历史靠滚动加载，见技术方案 §7.6）
 * - 消息行：.ds-message；用户正文：.ds-collapsible-text；助手正文：.ds-markdown
 * - 注意：思考过程（.ds-think-content）内部也有 .ds-markdown，需排除
 * - 无平台消息 ID、无 data-testid → 走指纹去重路径
 * - 滚动容器：.ds-scroll-area（包含虚拟列表的那个）
 * ⚠️ 账号菜单未在保存页中渲染（ DeepSeek 不展开时无账号线索）→ 通常落 default 桶
 */
import type {
  AccountHintInput,
  AdapterContext,
  AdapterDiagnosis,
  ConversationRef,
  ParseFrame,
  PlatformAdapter,
  RawMessage,
} from '../../core/types';
import { extractHtml, extractText, idFromPath } from './base';
import { pick, type SelectorSpec } from './selectors';

const S = {
  virtualList: {
    name: 'message-list',
    selectors: ['.ds-virtual-list-items'],
    required: true,
  },
  messageRow: {
    name: 'message-row',
    selectors: ['.ds-message'],
    required: true,
  },
  userContent: {
    name: 'user-content',
    selectors: ['.ds-collapsible-text'],
  },
  assistantContent: {
    name: 'assistant-content',
    selectors: ['.ds-markdown'],
  },
  scrollArea: {
    name: 'scroll-area',
    selectors: ['.ds-scroll-area'],
  },
  account: {
    name: 'account',
    // 保存页未渲染账号菜单；侧边栏底部用户区作为未验证候选
    selectors: ['[class*=user-info]', '[class*=account]', '.ds-sidebar [class*=footer]'],
  },
} satisfies Record<string, SelectorSpec>;

/** 助手正文：.ds-markdown 但排除思考过程内部的 */
function answerMarkdown(row: Element): Element | null {
  for (const md of Array.from(row.querySelectorAll('.ds-markdown'))) {
    if (!md.closest('.ds-think-content')) return md;
  }
  return null;
}

export const deepseekAdapter: PlatformAdapter = {
  id: 'deepseek',
  version: '1.0.0-verified-2026-10-31',
  displayName: 'DeepSeek',
  hosts: ['chat.deepseek.com'],

  match(url: URL): boolean {
    return url.hostname === 'chat.deepseek.com' && idFromPath(url, /^\/a\/chat\/s\/([^/]+)/) !== null;
  },

  getConversation(ctx: AdapterContext): ConversationRef | null {
    const id = idFromPath(ctx.url, /^\/a\/chat\/s\/([^/]+)/);
    return id ? { platformConversationId: id, source: 'url' } : null;
  },

  getAccountHint(ctx: AdapterContext): AccountHintInput | null {
    const misses: string[] = [];
    const el = pick(ctx.document, S.account, misses);
    const text = el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (!text || text.length < 2) return null;
    if (text.includes('@')) return { rawId: text, label: text, source: 'email' };
    if (/^1[3-9]\d{9}$/.test(text)) return { rawId: text, label: text, source: 'dom-id' };
    return { rawId: `deepseek-user:${text}`, label: text, source: 'avatar' };
  },

  getTitle(ctx: AdapterContext): string | null {
    // 实测：<title>为 "会话名 - DeepSeek"
    const t = ctx.document.querySelector('title')?.textContent?.trim();
    if (t) return t.replace(/\s*-\s*DeepSeek\s*$/, '');
    return null;
  },

  getMessageRoot(ctx: AdapterContext): Element | null {
    const misses: string[] = [];
    return pick(ctx.document, S.virtualList, misses);
  },

  getMessageNodes(ctx: AdapterContext): Element[] {
    const root = this.getMessageRoot(ctx);
    return root ? Array.from(root.querySelectorAll('.ds-message')) : [];
  },

  parseMessage(node: Element, ctx: AdapterContext, frame?: ParseFrame): RawMessage | null {
    const nodes = frame?.nodes ?? this.getMessageNodes(ctx);
    const index = frame?.index ?? nodes.indexOf(node);
    const user = node.querySelector('.ds-collapsible-text');
    if (user) {
      return { role: 'user', text: extractText(user), domIndex: index };
    }
    const md = answerMarkdown(node);
    if (md) {
      const streaming = index === nodes.length - 1 && this.isStreaming(ctx);
      return {
        role: 'assistant',
        text: extractText(md),
        html: extractHtml(md),
        domIndex: index,
        streaming,
      };
    }
    return null;
  },

  isStreaming(ctx: AdapterContext): boolean {
    // 实测保存页（已完成会话）无停止按钮；生成中会出现"停止"按钮或 loading 态
    return Array.from(ctx.document.querySelectorAll('button, [role=button]')).some((b) =>
      /停止/.test(`${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`),
    );
  },

  getScrollContainer(ctx: AdapterContext): HTMLElement | null {
    const misses: string[] = [];
    const list = this.getMessageRoot(ctx);
    for (const area of Array.from(pickAllSafe(ctx, S.scrollArea, misses))) {
      if (area.contains(list)) return area as HTMLElement;
    }
    return null;
  },

  diagnose(ctx: AdapterContext): AdapterDiagnosis {
    const misses: string[] = [];
    pick(ctx.document, S.virtualList, misses);
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

/** 内部小工具：pickAll 语义但不记重复 misses */
function pickAllSafe(ctx: AdapterContext, spec: SelectorSpec, misses: string[]): Element[] {
  for (const sel of spec.selectors) {
    try {
      const list = Array.from(ctx.document.querySelectorAll(sel));
      if (list.length > 0) return list;
    } catch {
      /* ignore */
    }
  }
  misses.push(spec.name);
  return [];
}
