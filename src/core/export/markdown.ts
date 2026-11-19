/**
 * Markdown 导出（默认导出格式，技术方案 §13.2）。
 * 代码块语言从 <pre><code class="language-xxx"> 提取；图片只输出链接。
 */
import type { Conversation, Message } from '../types';

function escapeMd(text: string): string {
  return text;
}

function htmlToMd(html: string, imageMode: 'link' | 'omit' = 'link'): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const kids = () => Array.from(el.childNodes).map(walk).join('');
    switch (el.tagName) {
      case 'P':
        return `${kids()}\n\n`;
      case 'BR':
        return '\n';
      case 'STRONG':
      case 'B':
        return `**${kids()}**`;
      case 'EM':
      case 'I':
        return `*${kids()}*`;
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return `${'#'.repeat(Number(el.tagName[1]))} ${kids()}\n\n`;
      case 'LI':
        return `- ${kids()}\n`;
      case 'UL':
      case 'OL':
        return `${kids()}\n`;
      case 'BLOCKQUOTE':
        return kids()
          .split('\n')
          .map((l) => (l ? `> ${l}` : l))
          .join('\n');
      case 'PRE': {
        const code = el.querySelector('code');
        const lang = code?.className.match(/language-([\w+-]+)/)?.[1] ?? '';
        return `\`\`\`${lang}\n${(code ?? el).textContent ?? ''}\n\`\`\`\n\n`;
      }
      case 'CODE':
        return `\`${el.textContent ?? ''}\``;
      case 'A': {
        const href = el.getAttribute('href');
        const label = kids();
        if (el.getAttribute('data-archive-image') === 'true') {
          if (imageMode === 'omit') return ''; // 图片省略模式：占位链接也不输出
          return `![${label.replace(/^\[图片[：:]?/, '').replace(/\]$/, '')}](${href})`;
        }
        return href ? `[${label}](${href})` : label;
      }
      case 'HR':
        return '\n---\n\n';
      case 'TABLE':
        return kids();
      default:
        return kids();
    }
  };
  return Array.from(tpl.content.childNodes).map(walk).join('').trim();
}

function messageToMd(m: Message, imageMode: 'link' | 'omit'): string {
  const who = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role;
  const body = m.contentHtml ? htmlToMd(m.contentHtml, imageMode) : escapeMd(m.contentText);
  return `## ${who}\n\n${body}\n`;
}

export function conversationToMarkdown(
  conv: Conversation,
  messages: Message[],
  opts: { imageMode?: 'link' | 'omit' } = {},
): string {
  const fm = [
    '---',
    `platform: ${conv.platform}`,
    `account: ${conv.accountLabel}`,
    `conversation_id: ${conv.id}`,
    `title: ${conv.title}`,
    `url: ${conv.url}`,
    `created_at: ${new Date(conv.createdAt).toISOString()}`,
    `updated_at: ${new Date(conv.updatedAt).toISOString()}`,
    `message_count: ${conv.messageCount}`,
  ];
  // 模型信息：取最近一条带模型标识的助手消息（借鉴 socketteer 的模型保留思路）
  const lastModel = [...messages].reverse().find((m) => m.model)?.model;
  if (lastModel) fm.push(`model: ${lastModel}`);
  fm.push('---');
  const body = messages
    .filter((m) => m.status === 'complete')
    .sort((a, b) => a.order - b.order)
    .map((m) => messageToMd(m, opts.imageMode ?? 'link'))
    .join('\n');
  return `${fm.join('\n')}\n\n# ${conv.title}\n\n${body}\n`;
}
