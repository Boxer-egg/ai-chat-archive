// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '@core/sanitize';
import { conversationToMarkdown } from '@core/export/markdown';

describe('sanitizeHtml（U18）', () => {
  it('剥离 script / onerror / javascript: 链接 / iframe / style', () => {
    const dirty =
      '<p onclick="x()">hi</p><script>alert(1)</script>' +
      '<img src="https://evil/x" onerror="alert(2)">' +
      '<a href="javascript:alert(3)">click</a>' +
      '<iframe src="https://evil"></iframe><style>body{}</style>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('iframe');
    expect(clean).not.toContain('style');
    expect(clean).not.toContain('<img');
    expect(clean).toContain('hi');
  });

  it('保留基础排版、代码块语言、正常链接', () => {
    const dirty =
      '<pre><code class="language-ts evil-class">const a=1;</code></pre>' +
      '<p><strong>加粗</strong> <a href="https://example.com" title="t">链接</a></p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('language-ts');
    expect(clean).not.toContain('evil-class');
    expect(clean).toContain('<strong>');
    expect(clean).toContain('href="https://example.com"');
  });

  it('图片转占位链接并保留原始 URL', () => {
    const clean = sanitizeHtml('<p><img src="https://cdn.example/p.png" alt="截图"></p>');
    expect(clean).not.toContain('<img');
    expect(clean).toContain('https://cdn.example/p.png');
    expect(clean).toContain('图片');
  });

  it('KaTeX 数学公式保留 TeX 原文（借鉴 pionxzh protectMath）', () => {
    const katexInline =
      '<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>c</mi></mrow>' +
      '<annotation encoding="application/x-tex">c = \\pm\\sqrt{a^2 + b^2}</annotation>' +
      '</semantics></math></span><span class="katex-html" aria-hidden="true"><span>𝑐=±√</span></span></span>';
    const katexBlock =
      '<div class="katex-display"><span class="katex"><span class="katex-mathml"><math display="block"><semantics>' +
      '<annotation encoding="application/x-tex">E = mc^2</annotation>' +
      '</semantics></math></span><span class="katex-html" aria-hidden="true"></span></span></div>';
    const clean = sanitizeHtml(`<p>勾股定理 ${katexInline} 成立</p>${katexBlock}`);
    expect(clean).toContain('$c = \\pm\\sqrt{a^2 + b^2}$');
    expect(clean).toContain('$$E = mc^2$$');
    expect(clean).not.toContain('katex-html'); // 渲染符号不再混入
    expect(clean).not.toContain('𝑐=±'); // 剥标签后的散文本也没有
    expect(clean).toContain('勾股定理');
  });

  it('导出的 Markdown 含数学标记', () => {
    const html = sanitizeHtml(
      '<p><span class="katex"><span class="katex-mathml"><math><semantics>' +
        '<annotation encoding="application/x-tex">x^2 + y^2 = z^2</annotation>' +
        '</semantics></math></span><span class="katex-html"></span></span></p>',
    );
    const msg = {
      id: 'c#m1',
      conversationId: 'c',
      msgKey: 'f:x#0',
      role: 'assistant' as const,
      contentText: 'x^2 + y^2 = z^2',
      contentHtml: html,
      order: 1024,
      fingerprint: 'x',
      contentHash: 'x',
      status: 'complete' as const,
      savedAt: 1,
      updatedAt: 1,
      adapterVersion: 't',
    };
    const conv = {
      id: 'c',
      platform: 'kimi' as const,
      accountKey: 'a',
      accountLabel: '账***',
      platformConversationId: 'p1',
      title: '数学',
      url: 'https://www.kimi.com/chat/p1',
      createdAt: 1,
      updatedAt: 1,
      lastSyncedAt: 1,
      messageCount: 1,
      adapterVersion: 't',
      source: 'url' as const,
      urlHistory: [],
    };
    const md = conversationToMarkdown(conv, [msg]);
    expect(md).toContain('$x^2 + y^2 = z^2$');
  });
});
