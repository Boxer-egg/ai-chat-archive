// @vitest-environment jsdom
/**
 * Markdown 导出图片模式（借鉴 pionxzh 的图片 omit/link 模式；
 * files+zip 模式受扩展 CSP connect-src 'none' 与零上传红线限制不做）
 */
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '@core/sanitize';
import { conversationToMarkdown } from '@core/export/markdown';
import type { Conversation, Message } from '@core/types';

const conv: Conversation = {
  id: 'c',
  platform: 'chatgpt',
  accountKey: 'a',
  accountLabel: '账***',
  platformConversationId: 'p1',
  title: '图片测试',
  url: 'https://chatgpt.com/c/p1',
  createdAt: 1,
  updatedAt: 1,
  lastSyncedAt: 1,
  messageCount: 1,
  adapterVersion: 't',
  source: 'url',
  urlHistory: [],
};

function assistantMsg(html: string): Message {
  return {
    id: 'c#m1',
    conversationId: 'c',
    msgKey: 'f:x#0',
    role: 'assistant',
    contentText: '看图',
    contentHtml: html,
    order: 1024,
    fingerprint: 'x',
    contentHash: 'x',
    status: 'complete',
    savedAt: 1,
    updatedAt: 1,
    adapterVersion: 't',
  };
}

describe('图片导出模式', () => {
  // 真实管线：输入 <img>，由 sanitize 的 replaceImages 生成占位链接（data-archive-image
  // 标记在 DOMPurify 之后才打上——消毒阶段 ALLOW_DATA_ATTR:false 会剥掉输入里的 data 属性）
  const htmlWithImage = sanitizeHtml(
    '<p>说明<img src="https://cdn.example/p.png" alt="截图">如图</p>',
  );

  it('link 模式（默认）：输出 ![alt](url)', () => {
    const md = conversationToMarkdown(conv, [assistantMsg(htmlWithImage)]);
    expect(md).toContain('![截图](https://cdn.example/p.png)');
  });

  it('omit 模式：图片整段不输出，正文保留', () => {
    const md = conversationToMarkdown(conv, [assistantMsg(htmlWithImage)], { imageMode: 'omit' });
    expect(md).not.toContain('cdn.example');
    expect(md).not.toContain('[图片');
    expect(md).toContain('说明');
    expect(md).toContain('如图');
  });

  it('未指定模式时与 link 一致', () => {
    const md = conversationToMarkdown(conv, [assistantMsg(htmlWithImage)]);
    expect(md).toContain('![');
  });
});
