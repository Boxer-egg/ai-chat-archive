/**
 * 开发/测试用夹具适配器：匹配本地夹具站点，DOM 结构复刻平台会话页。
 * 仅用于 vitest 集成测试与本地 fixture-server（E2E），生产 manifest 不含它。
 */
import type {
  AccountHintInput,
  AdapterContext,
  AdapterDiagnosis,
  ConversationRef,
  ParseFrame,
  PlatformAdapter,
  RawMessage,
} from '../../../core/types';
import { extractText, findScrollable, idFromPath } from '../base';
import { pickAll, type SelectorSpec } from '../selectors';

const S = {
  messageNode: {
    name: 'message-node',
    // data-role 是夹具的语义锚点，对应 ChatGPT 的 data-message-author-role
    selectors: ['[data-message-author-role]'],
    required: true,
  },
  account: {
    name: 'account',
    selectors: ['[data-testid="account-menu"]'],
  },
  streaming: {
    name: 'streaming',
    selectors: ['[data-testid="stop-button"]'],
  },
} satisfies Record<string, SelectorSpec>;

export const fixtureAdapter: PlatformAdapter = {
  id: 'chatgpt', // 借用一个平台 id，让数据模型路径也被覆盖到
  version: 'fixture-1.0',
  displayName: 'Fixture',
  hosts: ['127.0.0.1', 'localhost'],

  match(url: URL): boolean {
    return /^(127\.0\.0\.1|localhost)$/.test(url.hostname);
  },

  getConversation(ctx: AdapterContext): ConversationRef | null {
    const id = idFromPath(ctx.url, /^\/chat\/([^/]+)/);
    return id ? { platformConversationId: id, source: 'url' } : null;
  },

  getAccountHint(ctx: AdapterContext): AccountHintInput | null {
    const el = ctx.document.querySelector('[data-testid="account-menu"]');
    const text = el?.textContent?.trim() ?? '';
    if (!text) return null;
    if (text.includes('@')) return { rawId: text, label: text, source: 'email' };
    return { rawId: text, label: text, source: 'workspace' };
  },

  getTitle(ctx: AdapterContext): string | null {
    return ctx.document.querySelector('[data-testid="conversation-title"]')?.textContent?.trim() || null;
  },

  getMessageRoot(ctx: AdapterContext): Element | null {
    return ctx.document.querySelector('[data-testid="message-list"]');
  },

  getMessageNodes(ctx: AdapterContext): Element[] {
    const misses: string[] = [];
    return pickAll(ctx.document, S.messageNode, misses);
  },

  parseMessage(node: Element, ctx: AdapterContext, frame?: ParseFrame): RawMessage | null {
    const nodes = frame?.nodes ?? this.getMessageNodes(ctx);
    const index = frame?.index ?? nodes.indexOf(node);
    const role = node.getAttribute('data-message-author-role');
    if (role !== 'user' && role !== 'assistant') return null;
    const content = node.querySelector('[data-testid="message-content"]') ?? node;
    return {
      role,
      text: extractText(content),
      domIndex: index,
      streaming: role === 'assistant' && index === nodes.length - 1 && this.isStreaming(ctx),
    };
  },

  isStreaming(ctx: AdapterContext): boolean {
    return !!ctx.document.querySelector('[data-testid="stop-button"]');
  },

  getScrollContainer(ctx: AdapterContext): HTMLElement | null {
    const root = this.getMessageRoot(ctx);
    return root ? findScrollable(root.parentElement) : null;
  },

  diagnose(ctx: AdapterContext): AdapterDiagnosis {
    const misses: string[] = [];
    const nodes = pickAll(ctx.document, S.messageNode, misses);
    const failures = nodes.filter((n) => this.parseMessage(n, ctx) === null).length;
    return {
      status: nodes.length === 0 ? 'broken' : failures > 0 ? 'degraded' : 'ok',
      messageCount: nodes.length,
      misses,
    };
  },
};
