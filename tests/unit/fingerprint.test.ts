import { describe, expect, it } from 'vitest';
import { contentHash, fingerprint, msgKeyFor, normalize } from '@core/merge/fingerprint';
import { similarity } from '@core/merge/merge-snapshot';

describe('normalize（U01）', () => {
  it('去除零宽字符、统一换行、压缩行尾空白与连续空行', () => {
    const dirty = 'a\u200bb\r\n c  \n\n\n\nd';
    expect(normalize(dirty)).toBe('ab\n c\n\nd');
  });

  it('首行缩进随 trim 去掉，其余行缩进保留', () => {
    const code = '  const x = 1;\n    return x;';
    expect(normalize(code)).toBe('const x = 1;\n    return x;');
  });
});

describe('contentHash / fingerprint（U02）', () => {
  it('同一文本两次计算结果相同', async () => {
    const a = await contentHash('你好');
    const b = await contentHash('你好');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('大小写/标点不同则哈希不同', async () => {
    expect(await contentHash('Hello')).not.toBe(await contentHash('hello'));
    expect(await contentHash('你好')).not.toBe(await contentHash('你好！'));
  });

  it('角色参与指纹：同文本不同角色指纹不同', async () => {
    expect(await fingerprint('user', '继续')).not.toBe(await fingerprint('assistant', '继续'));
  });
});

describe('msgKeyFor（§6.1）', () => {
  it('平台 ID + 角色（同一 turn-key 下区分用户/助手）', () => {
    expect(msgKeyFor('abc', 'ff', 0, 'user')).toBe('p:abc:user');
    expect(msgKeyFor('abc', 'ff', 0, 'assistant')).toBe('p:abc:assistant');
  });
  it('指纹键带出现序号', () => {
    expect(msgKeyFor(undefined, 'ff', 2)).toBe('f:ff#2');
  });
});

describe('similarity（编辑检测）', () => {
  it('高度相似 > 0.6，无关文本 < 0.6', () => {
    expect(similarity('a\nb\nc', 'a\nb\nc\nd')).toBeGreaterThan(0.6);
    expect(similarity(' completely different\nwords here', 'a\nb\nc')).toBeLessThan(0.6);
  });
});
