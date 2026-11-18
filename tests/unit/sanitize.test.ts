// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '@core/sanitize';

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
});
