import { describe, expect, it } from 'vitest';
import { diffMatch } from '@core/merge/diff';

describe('diffMatch（§7.3）', () => {
  it('相同序列完全配对', () => {
    const a = ['x', 'y', 'z'];
    expect(diffMatch(a, a)).toEqual([
      { aIndex: 0, bIndex: 0 },
      { aIndex: 1, bIndex: 1 },
      { aIndex: 2, bIndex: 2 },
    ]);
  });

  it('前插：b 前面加一段，后面整体平移仍配对', () => {
    const a = ['m1', 'm2', 'm3'];
    const b = ['h1', 'h2', 'm1', 'm2', 'm3'];
    const pairs = diffMatch(a, b);
    expect(pairs).toContainEqual({ aIndex: 0, bIndex: 2 });
    expect(pairs).toContainEqual({ aIndex: 2, bIndex: 4 });
    expect(pairs).toHaveLength(3);
  });

  it('空序列', () => {
    expect(diffMatch([], ['a'])).toEqual([]);
    expect(diffMatch(['a'], [])).toEqual([]);
  });

  it('重复元素按出现次序配对', () => {
    const a = ['go', 'go', 'end'];
    const b = ['go', 'go', 'go', 'end'];
    const pairs = diffMatch(a, b);
    expect(pairs).toEqual([
      { aIndex: 0, bIndex: 0 },
      { aIndex: 1, bIndex: 1 },
      { aIndex: 2, bIndex: 3 },
    ]);
  });
});
