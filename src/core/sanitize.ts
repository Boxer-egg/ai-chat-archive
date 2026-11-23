/**
 * HTML 消毒（技术方案 §10.3）：入库前清洗 AI 输出的不可信 HTML。
 * 白名单标签 + 白名单属性；<img> 一律转占位链接（不触发对平台 CDN 的请求）。
 */
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'pre', 'code', 'ul', 'ol', 'li', 'blockquote',
  'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'hr', 'span', 'div', 'img',
  'details', 'summary', // 思考过程折叠块（kimi.ts 生成）
];

const ALLOWED_ATTR = ['href', 'title', 'class', 'src', 'alt'];

const ALLOWED_CLASS_PREFIX = ['language-', 'code-block', 'math', 'katex'];

function classAllowed(cls: string): boolean {
  return ALLOWED_CLASS_PREFIX.some((p) => cls.startsWith(p));
}

/** 用占位链接替换图片（保留原始 URL 供点击跳转） */
function replaceImages(root: ParentNode, doc: Document): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const a = doc.createElement('a');
    a.textContent = img.alt ? `[图片：${img.alt}]` : '[图片]';
    a.setAttribute('href', img.getAttribute('src') ?? '#');
    a.setAttribute('data-archive-image', 'true');
    img.replaceWith(a);
  }
}

/**
 * KaTeX 数学公式保护（借鉴 pionxzh/chatgpt-exporter 的 protectMath 思路）：
 * KaTeX 依赖的 mathml/annotation 标签不在白名单，DOMPurify 消毒后 TeX 原文
 * 会散成文本且混着 katex-html 的渲染符号。必须在消毒前把 .katex 整体替换为
 * 保留 TeX 的占位 span（class 带 math- 前缀，class 白名单放行）：
 *   行内 → <span class="math-inline">$...$</span>
 *   独立行（.katex-display 祖先）→ <span class="math-display">$$...$$</span>
 * 导出 Markdown 时占位 span 走默认分支原样输出文本，无需额外处理。
 */
function replaceMath(root: ParentNode, doc: Document): void {
  for (const katex of Array.from(root.querySelectorAll('span.katex'))) {
    const tex = katex
      .querySelector('annotation[encoding="application/x-tex"]')
      ?.textContent?.trim();
    if (!tex) continue; // 非标准结构：保留原样降级
    const display = katex.closest('.katex-display') !== null;
    const span = doc.createElement('span');
    span.className = display ? 'math-display' : 'math-inline';
    span.textContent = display ? `$$${tex}$$` : `$${tex}$`;
    katex.replaceWith(span);
  }
}

export function sanitizeHtml(dirty: string): string {
  // 数学公式在消毒前处理（annotation 标签消毒后无法提取）
  const pre = document.createElement('template');
  pre.innerHTML = dirty; // 仅做 DOM 查询与替换，不触发脚本；随后全部经 DOMPurify
  replaceMath(pre.content, document);

  const clean = DOMPurify.sanitize(pre.innerHTML, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  // DOMPurify 返回 TrustedHTML/string；转成 DOM 再做图片替换与 class 过滤
  const tpl = document.createElement('template');
  tpl.innerHTML = String(clean);
  replaceImages(tpl.content, document);
  for (const el of Array.from(tpl.content.querySelectorAll<HTMLElement>('*'))) {
    for (const cls of Array.from(el.classList)) {
      if (!classAllowed(cls)) el.classList.remove(cls);
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (!/^https?:\/\//.test(href)) el.removeAttribute('href');
    }
  }
  const host = document.createElement('div');
  host.appendChild(tpl.content.cloneNode(true));
  return host.innerHTML;
}
