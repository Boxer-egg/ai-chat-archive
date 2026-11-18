/**
 * ChatGPT 适配器（chatgpt.com / chat.openai.com）。
 * ✅ 已实测校正（2026-11-02，DevTools 导出的水合后 <main> DOM，2025 新版 app-shell UI）：
 * - 滚动容器：[class*="thread-scroll-container"]（overflow-y-auto）
 * - 用户消息：.text-size-chat.whitespace-pre-wrap（每条一个，气泡 bg-user-message 内）
 * - 助手消息：[class*=MarkdownRoot]（段落带 data-markdown-han-text）
 * - 注意：新版 UI 没有 article / data-message-author-role / data-message-id
 *   （旧版选择器保留为候选兜底）；无消息 ID → 指纹去重
 * - 虚拟化：存在 data-virtualized-turn-content 机制，长对话只渲染可见窗口
 * - 账号：html[data-theme-user-id]（实测，最稳定）
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
  scroller: {
    name: 'message-list',
    selectors: ['[class*="thread-scroll-container"]', '[class*="react-scroll-to-bottom"]', 'main'],
    required: true,
  },
  userText: {
    name: 'user-message',
    selectors: ['.text-size-chat.whitespace-pre-wrap'],
    required: true,
  },
  assistantMd: {
    name: 'assistant-message',
    selectors: ['[class*=MarkdownRoot]'],
    required: true,
  },
  account: {
    name: 'account',
    selectors: ['button[data-testid="accounts-profile-button"]', '[aria-label*="profile" i] button'],
  },
} satisfies Record<string, SelectorSpec>;

/** 旧版 UI 候选（若回滚或部分页面仍是旧版，优先尝试） */
const LEGACY_ROW = 'article[data-testid^="conversation-turn"]';

export const chatgptAdapter: PlatformAdapter = {
  id: 'chatgpt',
  version: '1.0.0-verified-2026-11-02',
  displayName: 'ChatGPT',
  hosts: ['chatgpt.com', 'chat.openai.com'],

  match(url: URL): boolean {
    return (
      (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com') &&
      idFromPath(url, /^\/c\/([0-9a-f-]{8,})/i) !== null
    );
  },

  getConversation(ctx: AdapterContext): ConversationRef | null {
    const id = idFromPath(ctx.url, /^\/c\/([0-9a-f-]{8,})/i);
    return id ? { platformConversationId: id, source: 'url' } : null;
  },

  getAccountHint(ctx: AdapterContext): AccountHintInput | null {
    // 实测：html 标签带 data-theme-user-id（最稳定）；昵称在侧边栏按钮里作展示名
    const userId = ctx.document.documentElement?.getAttribute?.('data-theme-user-id');
    const misses: string[] = [];
    const el = pick(ctx.document, S.account, misses);
    const name = el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (userId) return { rawId: userId, label: name || userId, source: 'dom-id' };
    if (!name) return null;
    if (name.includes('@')) return { rawId: name, label: name, source: 'email' };
    return { rawId: `chatgpt-user:${name}`, label: name, source: 'avatar' };
  },

  getTitle(ctx: AdapterContext): string | null {
    // <main> 导出没有 <title>；真实页面 title 为 "会话名 - ChatGPT"
    const t = ctx.document.querySelector('title')?.textContent?.trim();
    if (t) return t.replace(/\s*[-–]\s*ChatGPT\s*$/, '');
    return null;
  },

  getMessageRoot(ctx: AdapterContext): Element | null {
    const misses: string[] = [];
    return pick(ctx.document, S.scroller, misses);
  },

  getMessageNodes(ctx: AdapterContext): Element[] {
    // 新旧版并集；按文档顺序合并。
    // 注意：输入框 .text-size-chat.whitespace-pre-wrap 与消息同 class，必须用气泡祖先区分
    const userNodes = Array.from(
      ctx.document.querySelectorAll('.text-size-chat.whitespace-pre-wrap'),
    ).filter((el) => el.closest('[class*=bg-user-message]') !== null);
    const nodes = [
      ...userNodes,
      ...Array.from(ctx.document.querySelectorAll('[class*=MarkdownRoot]')),
      ...Array.from(ctx.document.querySelectorAll(LEGACY_ROW)),
    ];
    return nodes.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  },

  parseMessage(node: Element, ctx: AdapterContext, frame?: ParseFrame): RawMessage | null {
    const nodes = frame?.nodes ?? this.getMessageNodes(ctx);
    const index = frame?.index ?? nodes.indexOf(node);
    const isUser =
      node.matches('.text-size-chat.whitespace-pre-wrap') || !!node.closest('[class*=bg-user-message]');
    const isAssistant = node.matches('[class*=MarkdownRoot]');
    if (isUser) {
      return { role: 'user', text: extractText(node), domIndex: index };
    }
    if (isAssistant) {
      return {
        role: 'assistant',
        text: extractText(node),
        html: extractHtml(node),
        domIndex: index,
        streaming: index === nodes.length - 1 && this.isStreaming(ctx),
      };
    }
    // 旧版整轮 article：拆出角色
    const legacy = node.querySelector('[data-message-author-role]');
    if (legacy) {
      const role = legacy.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
      return {
        role,
        text: extractText(legacy),
        html: extractHtml(legacy),
        domIndex: index,
        platformMessageId: legacy.getAttribute('data-message-id') ?? undefined,
      };
    }
    return null;
  },

  isStreaming(ctx: AdapterContext): boolean {
    return Array.from(ctx.document.querySelectorAll('button')).some((b) =>
      /停止|stop/i.test(
        `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('data-testid') ?? ''}`,
      ),
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
