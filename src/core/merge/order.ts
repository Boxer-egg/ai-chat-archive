/**
 * 顺序号（技术方案 §7.4）：浮点 + 留空隙，插队不用重排，精度耗尽才整段重排。
 */
import { ORDER_GAP } from '../../shared/constants';

/** 初始顺序：第 i 条 → (i+1) * GAP */
export function initialOrder(i: number): number {
  return (i + 1) * ORDER_GAP;
}

/** 在 a、b 之间取一个可用序号；a/b 为 null 表示无界 */
export function orderBetween(a: number | null, b: number | null): number {
  if (a === null && b === null) return initialOrder(0);
  if (a === null) return b! - ORDER_GAP;
  if (b === null) return a + ORDER_GAP;
  const mid = (a + b) / 2;
  // double 精度守卫：中点与两端没有足够的可分辨空间 → 触发重排
  if (mid === a || mid === b) return Number.NaN;
  return mid;
}

/**
 * 判断一组新分配的序号是否需要整段重排。
 * 只要任何一个 orderBetween 返回 NaN（精度耗尽），就需要 renumber。
 */
export function needsRenumber(orders: number[]): boolean {
  return orders.some((o) => Number.isNaN(o));
}

/** 整段重排：按当前顺序重新赋 (i+1)*GAP */
export function renumber<T extends { order: number }>(items: T[]): T[] {
  return items.map((m, i) => ({ ...m, order: initialOrder(i) }));
}
