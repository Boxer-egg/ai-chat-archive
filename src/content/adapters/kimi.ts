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
import { extractHtml, extractModelHint, extractText, findScrollable, idFromPath } from './base';
import { pick, type SelectorSpec } from './selectors';
import { sanitizeHtml } from '../../core/sanitize';

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

/** 文本进 HTML 前的转义（思考步骤内容拼接用） */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 提取思考过程为 <details> 折叠块（2026-11-23 实测两种形态）：
 * - .toolcall-flow__item：Kimi 思考折叠面板的步骤；内容在 .toolcall-content
 *   （懒渲染：折叠时为空，展开后才有文本，见 prepareForSnapshot）
 * - 正文容器之前的 plain markdown-container：思考中间步骤文本
 * 思考不进 contentText（保持搜索与导出正文干净），只随 HTML 归档。
 */
function thinkingDetailsHtml(node: Element, bodyMd: Element): string | undefined {
  const steps: string[] = [];
  for (const item of Array.from(node.querySelectorAll('.toolcall-flow__item'))) {
    const title = item.querySelector('.toolcall-title-name-text')?.textContent?.trim();
    // 内容：懒渲染容器 .toolcall-content（含代码块时剔除 .sticky-release 工具条）
    let content = '';
    const contentEl = item.querySelector('.toolcall-content');
    if (contentEl) {
      const clone = contentEl.cloneNode(true) as Element;
      for (const n of Array.from(clone.querySelectorAll('.sticky-release'))) n.remove();
      content = (clone.textContent ?? '').trim();
    }
    if (!content) {
      // 兼容旧结构：内容直接放在 .markdown-container 里
      content = [...item.querySelectorAll('.markdown-container')]
        .map((m) => {
          const c = m.cloneNode(true) as Element;
          for (const n of Array.from(c.querySelectorAll('.sticky-release'))) n.remove();
          return c.textContent?.trim() ?? '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (!title && !content) continue;
    steps.push(
      (title ? `<p><strong>${escapeHtmlText(title)}</strong></p>` : '') +
        (content ? `<p>${escapeHtmlText(content)}</p>` : ''),
    );
  }
  const plain = Array.from(node.querySelectorAll('.markdown-container')).filter(
    (el) => !el.className.toString().includes('toolcall'),
  );
  const bodyIdx = plain.indexOf(bodyMd);
  for (const m of plain.slice(0, bodyIdx === -1 ? 0 : bodyIdx)) {
    const t = m.textContent?.trim();
    if (t) steps.push(`<p>${escapeHtmlText(t)}</p>`);
  }
  if (steps.length === 0) return undefined;
  return `<details><summary>思考过程（${steps.length} 步）</summary>${steps.join('')}</details>`;
}

/** 克隆后剔除操作行与卡片容器，避免"编辑/复制/分享"等噪音 */
function clean(segment: Element): { text: string; html?: string } {
  const clone = segment.cloneNode(true) as Element;
  for (const sel of [
    '.segment-user-action-row',
    '.segment-user-actions',
    '.okc-cards-container',
    '.segment-assistant-action-row',
    '[class*=action-row]',
    // 代码块头部工具条（语言标签 + 复制按钮，2026-11-23 实测 .sticky-release）
    '.sticky-release',
  ]) {
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
      // 2026-11-23 实机修正：一个回复段内有多个 .markdown-container——
      // 前面的是思考中间步骤，最后一个是正文（思考过程永远在前）。
      // 旧版取第一个会采到思考文本、丢失正文与 ASCII 图（用户反馈"没保存全"）。
      const plain = Array.from(node.querySelectorAll('.markdown-container')).filter(
        (el) => !el.className.toString().includes('toolcall'),
      );
      const md = plain[plain.length - 1];
      if (md) {
        const { text, html } = clean(md);
        // 思考过程归档为 details 折叠块，拼在正文前（contentText 只含正文）
        const thinking = thinkingDetailsHtml(node, md);
        const merged = thinking ? sanitizeHtml(thinking + (html ?? '')) : html;
        return {
          role,
          text,
          html: merged,
          domIndex: index,
          streaming: index === nodes.length - 1 && this.isStreaming(ctx),
          model: extractModelHint(node),
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

  /**
   * 展开懒渲染的思考步骤（.toolcall-content 折叠时不渲染内容）。
   * 点击已展开的跳过（aria-expanded=true），避免 MutationObserver 回环；
   * 内容异步渲染，下一波快照即可提取。
   */
  prepareForSnapshot(ctx: AdapterContext): void {
    for (const title of Array.from(
      ctx.document.querySelectorAll('.toolcall-title-container.is-expandable'),
    )) {
      if (title.getAttribute('aria-expanded') === 'true') continue;
      try {
        (title as HTMLElement).click();
      } catch {
        /* 单个展开失败不阻断 */
      }
    }
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
