/** 导出文件名清洗与组装（core/export/filename.ts） */
import { describe, expect, it } from 'vitest';
import { exportFileName, sanitizeFileName } from '@core/export/filename';

describe('sanitizeFileName', () => {
  it('去除各系统非法字符', () => {
    expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j')).toBe('abcdefghij');
  });

  it('折叠空白并去首尾点（Windows 尾点限制）', () => {
    expect(sanitizeFileName('  我的   会话  .')).toBe('我的 会话');
    expect(sanitizeFileName('..hidden..')).toBe('hidden');
  });

  it('超长截断', () => {
    const long = '长'.repeat(100);
    expect(sanitizeFileName(long)).toHaveLength(60);
  });

  it('空或纯非法字符回退 untitled', () => {
    expect(sanitizeFileName('')).toBe('untitled');
    expect(sanitizeFileName('???')).toBe('untitled');
  });
});

describe('exportFileName', () => {
  const date = '2026-11-19';

  it('单会话导出：标题-日期.扩展名', () => {
    expect(exportFileName('解释哥德巴赫猜想', date, 'md')).toBe('解释哥德巴赫猜想-2026-11-19.md');
    expect(exportFileName('备份 "重要" 会话', date, 'json')).toBe('备份 重要 会话-2026-11-19.json');
  });

  it('全部导出/无标题：保持原命名', () => {
    expect(exportFileName(undefined, date, 'md')).toBe('ai-chat-archive-2026-11-19.md');
    expect(exportFileName('   ', date, 'json')).toBe('ai-chat-archive-2026-11-19.json');
  });
});
