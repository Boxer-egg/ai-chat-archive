import { describe, expect, it } from 'vitest';
import { initialOrder, needsRenumber, orderBetween, renumber } from '@core/merge/order';

describe('order（U07/U14）', () => {
  it('初始序号留空隙', () => {
    expect(initialOrder(0)).toBe(1024);
    expect(initialOrder(1)).toBe(2048);
  });

  it('中间插队', () => {
    const mid = orderBetween(1024, 2048);
    expect(mid).toBeGreaterThan(1024);
    expect(mid).toBeLessThan(2048);
  });

  it('最前/最后', () => {
    expect(orderBetween(null, 1024)).toBeLessThan(1024);
    expect(orderBetween(1024, null)).toBeGreaterThan(1024);
    expect(orderBetween(null, null)).toBe(1024);
  });

  it('精度耗尽返回 NaN 并触发重排（U14）', () => {
    let a = 1024;
    let b = 1024 + 1; // 极小间隔
    let last = a;
    let nanHit = false;
    for (let i = 0; i < 60; i++) {
      const mid = orderBetween(last, b);
      if (Number.isNaN(mid)) {
        nanHit = true;
        break;
      }
      last = mid;
    }
    expect(nanHit).toBe(true);
    expect(needsRenumber([Number.NaN])).toBe(true);
  });

  it('renumber 按当前顺序重排', () => {
    const out = renumber([{ order: 5 }, { order: 1 }, { order: 9 }]);
    expect(out.map((o) => o.order)).toEqual([1024, 2048, 3072]);
  });
});
