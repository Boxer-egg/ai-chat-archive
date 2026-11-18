/**
 * Myers diff（技术方案 §7.3）：与 git diff 同源。
 * 输入是两个等值判定序列，输出"同一条消息"的配对下标。
 * 元素是 contentHash，比较 O(1)；正常差异量 D 很小，几千条毫秒级。
 */

export interface DiffPair {
  aIndex: number;
  bIndex: number;
}

export function diffMatch<T>(
  a: T[],
  b: T[],
  equals: (x: T, y: T) => boolean = (x, y) => x === y,
): DiffPair[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];

  const max = n + m;
  const v = new Map<number, number>();
  const trace: Map<number, number>[] = [];
  let foundD = -1;

  const get = (k: number) => v.get(k) ?? -1;
  const set = (k: number, x: number) => v.set(k, x);

  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && get(k - 1) < get(k + 1))) {
        x = get(k + 1); // 向下（插入）
      } else {
        x = get(k - 1) + 1; // 向右（删除）
      }
      let y = x - k;
      while (x < n && y < m && equals(a[x], b[y])) {
        x++;
        y++;
      }
      set(k, x);
      if (x >= n && y >= m) {
        foundD = d;
        break outer;
      }
    }
  }
  if (foundD < 0) return [];

  // 回溯
  const pairs: DiffPair[] = [];
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    const getPrev = (kk: number) => vPrev.get(kk) ?? -1;
    let prevK: number;
    if (k === -d || (k !== d && getPrev(k - 1) < getPrev(k + 1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = getPrev(prevK);
    const prevY = prevX - prevK;

    // 蛇形（匹配）部分
    while (x > prevX && y > prevY) {
      pairs.push({ aIndex: x - 1, bIndex: y - 1 });
      x--;
      y--;
    }
    x = prevX;
    y = prevY;
  }
  // d=0 剩余的对角
  while (x > 0 && y > 0) {
    pairs.push({ aIndex: x - 1, bIndex: y - 1 });
    x--;
    y--;
  }
  pairs.reverse();
  return pairs;
}
