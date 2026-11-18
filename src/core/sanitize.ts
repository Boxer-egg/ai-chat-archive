/**
 * HTML 消毒（技术方案 §10.3）：入库前清洗 AI 输出的不可信 HTML。
 * 白名单标签 + 白名单属性；<img> 一律转占位链接（不触发对平台 CDN 的请求）。
 */
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'pre', 'code', 'ul', 'ol', 'li', 'blockquote',
  'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'hr', 'span', 'div', 'img',
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

export function sanitizeHtml(dirty: string): string {
  const clean = DOMPurify.sanitize(dirty, {
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
