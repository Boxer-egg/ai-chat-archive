/**
 * 适配器通用工具：角色推断、文本提取、滚动容器探测。
 */
import type { AdapterContext, RawMessage, Role } from '../../core/types';
import { sanitizeHtml } from '../../core/sanitize';

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BR']);

function walkText(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.textContent ?? '');
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (el.tagName === 'BR') {
    out.push('\n');
    return;
  }
  // pre/code 保留原始文本，不递归拼接
  if (el.tagName === 'PRE' || el.tagName === 'CODE') {
    out.push(el.textContent ?? '');
    if (el.tagName === 'PRE') out.push('\n');
    return;
  }
  for (const child of Array.from(el.childNodes)) walkText(child, out);
  if (BLOCK_TAGS.has(el.tagName)) out.push('\n');
}

/** 文本提取：块级元素之间补换行，保留代码缩进 */
export function extractText(el: Element): string {
  const out: string[] = [];
  for (const child of Array.from(el.childNodes)) walkText(child, out);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** 提取消毒后的 HTML（保留代码块/列表格式） */
export function extractHtml(el: Element): string | undefined {
  const html = el.innerHTML?.trim();
  if (!html) return undefined;
  try {
    return sanitizeHtml(html);
  } catch {
    return undefined; // 消毒失败降级为纯文本
  }
}

export function inferRole(node: Element, attrCandidates: string[]): Role | null {
  for (const attr of attrCandidates) {
    const v = node.getAttribute(attr)?.toLowerCase();
    if (v === 'user' || v === 'human') return 'user';
    if (v === 'assistant' || v === 'ai') return 'assistant';
  }
  return null;
}

/** 向上找可滚动的祖先（滚动容器探测） */
export function findScrollable(start: Element | null): HTMLElement | null {
  let el = start;
  while (el) {
    if (el instanceof HTMLElement) {
      const style = getComputedStyle(el);
      const canScroll =
        /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
      if (canScroll) return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * 元素是否处于隐藏祖先下（SPA 会把已切换走的旧内容保留在 display:none 容器里）。
 * 用计算样式链式检查而非几何信息，兼容 jsdom 等无布局环境（测试可直接用）。
 */
export function isHidden(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    const s = getComputedStyle(cur as HTMLElement);
    if (s.display === 'none' || s.visibility === 'hidden') return true;
    cur = cur.parentElement;
  }
  return false;
}

/** 从 URL 路径提取会话 ID 的通用工具 */
export function idFromPath(url: URL, pattern: RegExp): string | null {
  const m = url.pathname.match(pattern);
  return m ? m[1] : null;
}

/**
 * 尽力提取消息对应的模型标识：先看节点自身与祖先的 data-model，
 * 再看节点内 select 按钮的 aria-label（部分平台把当前模型放那里）。
 * 平台 DOM 未暴露时返回 undefined——各平台实测确认标识位置后可在此扩展。
 */
export function extractModelHint(node: Element): string | undefined {
  const el = node.closest('[data-model]');
  const fromAttr = el?.getAttribute('data-model')?.trim();
  if (fromAttr) return fromAttr;
  const label = node
    .querySelector('[aria-label]')
    ?.getAttribute('aria-label')
    ?.match(/gpt-\S+|claude[\w.-]*|sonnet|opus|haiku|deepseek[\w.-]*|kimi[\w.-]*|grok[\w.-]*/i)?.[0];
  return label ?? undefined;
}

export function makeCtx(url: string, document: Document, now = Date.now()): AdapterContext {
  return { url: new URL(url), document, now };
}

/** 组装 RawMessage 的通用收尾 */
export function rawMessage(
  node: Element,
  index: number,
  fields: Omit<RawMessage, 'domIndex'>,
): RawMessage {
  return { ...fields, domIndex: index };
}
