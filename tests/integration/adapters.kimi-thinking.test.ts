// @vitest-environment jsdom
/**
 * Kimi 思考过程归档（2026-11-23 实机结构）：
 * assistant 段 = 思考折叠面板（toolcall-flow__item：标题 + toolcall md 分析）
 * + 中间步骤 plain 容器 + 最后一个 plain 容器（正文）。
 * 思考应归档为 <details> 折叠块随 HTML 保存，contentText 只含正文。
 */
import { describe, expect, it } from 'vitest';
import { kimiAdapter } from '../../src/content/adapters/kimi';
import { makeCtx } from '../../src/content/adapters/base';
import { conversationToMarkdown } from '@core/export/markdown';
import type { Conversation } from '@core/types';

const assistantSeg = `
<div class="segment segment-assistant">
  <div class="toolcall-flow">
    <div class="toolcall-flow__item">
      <div class="toolcall-container thinking-container">
        <div class="toolcall-title-container">
          <span class="toolcall-title-name-text">使用画布进行编码</span>
        </div>
        <div class="markdown-container toolcall-content-text">Let me draw the boxes first</div>
      </div>
    </div>
    <div class="toolcall-flow__item">
      <div class="toolcall-container thinking-container">
        <div class="toolcall-title-container">
          <span class="toolcall-title-name-text">运行 Python 代码</span>
        </div>
        <div class="markdown-container toolcall-content-text">print('align check')</div>
      </div>
    </div>
  </div>
  <div class="markdown-container">基本骨架好了，现在加回流污泥环线。</div>
  <div class="markdown-container">
    <p>画好了，A²/O 工艺流程：</p>
    <div class="segment-code">
      <div class="sticky-release">plain 复制</div>
      <div class="syntax-highlighter"><pre><code>┌────┐
│格栅│
└────┘</code></pre></div>
    </div>
  </div>
</div>`;

const plainSeg = `
<div class="segment segment-assistant">
  <div class="markdown-container"><p>没有思考的普通回复</p></div>
</div>`;

const ctxOf = (body: string) =>
  makeCtx(
    'https://www.kimi.com/chat/1a191987-8fb2-8aad-8000-094650f7c061',
    new DOMParser().parseFromString(`<div class="message-list-container"></div>${body}`, 'text/html'),
  );

describe('Kimi 思考过程归档（details 折叠块）', () => {
  it('思考步骤进 details，正文（含 ASCII 图）完整，contentText 不含思考', () => {
    const ctx = ctxOf(assistantSeg);
    const raw = kimiAdapter.parseMessage(ctx.document.querySelector('.segment')!, ctx);
    expect(raw).not.toBeNull();
    // 正文纯文本：只有"画好了…"，没有思考内容
    expect(raw!.text).toContain('画好了');
    expect(raw!.text).toContain('格栅');
    expect(raw!.text).not.toContain('基本骨架');
    expect(raw!.text).not.toContain('使用画布');
    expect(raw!.text).not.toContain('plain 复制'); // 工具条已剔除
    // HTML：思考归档为 details（2 个工具步骤 + 1 个中间步骤 = 3 步）
    expect(raw!.html).toContain('<details>');
    expect(raw!.html).toContain('<summary>思考过程（3 步）</summary>');
    expect(raw!.html).toContain('使用画布进行编码');
    expect(raw!.html).toContain('基本骨架好了');
    // ASCII 图保留（方框字符在，且 details 之外）
    expect(raw!.html).toContain('│格栅│');
    expect(raw!.html!.indexOf('│格栅│')).toBeGreaterThan(raw!.html!.indexOf('</details>'));
  });

  it('无思考的段不产生 details', () => {
    const ctx = ctxOf(plainSeg);
    const raw = kimiAdapter.parseMessage(ctx.document.querySelector('.segment')!, ctx);
    expect(raw!.text).toContain('普通回复');
    expect(raw!.html).not.toContain('<details>');
  });

  it('导出 Markdown 保留折叠块', () => {
    const ctx = ctxOf(assistantSeg);
    const raw = kimiAdapter.parseMessage(ctx.document.querySelector('.segment')!, ctx);
    const conv: Conversation = {
      id: 'kimi:a:p1',
      platform: 'kimi',
      accountKey: 'a',
      accountLabel: '账***',
      platformConversationId: 'p1',
      title: '思考测试',
      url: 'https://www.kimi.com/chat/p1',
      createdAt: 1,
      updatedAt: 1,
      lastSyncedAt: 1,
      messageCount: 1,
      adapterVersion: 't',
      source: 'url',
      urlHistory: [],
    };
    const msg = {
      id: 'kimi:a:p1#m1',
      conversationId: 'kimi:a:p1',
      msgKey: 'f:x#0',
      role: 'assistant' as const,
      contentText: raw!.text,
      contentHtml: raw!.html,
      order: 1024,
      fingerprint: 'x',
      contentHash: 'x',
      status: 'complete' as const,
      savedAt: 1,
      updatedAt: 1,
      adapterVersion: 't',
    };
    const md = conversationToMarkdown(conv, [msg]);
    expect(md).toContain('<details>');
    expect(md).toContain('思考过程（3 步）');
    expect(md).toContain('使用画布进行编码');
  });
});
