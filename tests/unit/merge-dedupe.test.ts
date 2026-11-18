import { describe, expect, it } from 'vitest';
import { mergeSnapshot } from '@core/merge/merge-snapshot';
import type { Message, RawMessage, Role } from '@core/types';
import { initialOrder } from '@core/merge/order';

const CONV = 'chatgpt:default:conv-1';
let clock = 1_700_000_000_000;

const raw = (role: Role, text: string, domIndex: number, pid?: string, streaming = false): RawMessage => ({
  role,
  text,
  domIndex,
  platformMessageId: pid,
  streaming,
});

/** 从空库跑一轮，返回落库态消息（模拟真实使用：上一轮输出 = 下一轮的 existing） */
async function firstMerge(raws: RawMessage[]): Promise<Message[]> {
  const out = await mergeSnapshot({
    conversationId: CONV,
    existing: [],
    raws,
    now: (clock += 1000),
    adapterVersion: 'test',
  });
  expect(out.renumbered).toBe(false);
  return out.all;
}

async function nextMerge(existing: Message[], raws: RawMessage[]) {
  return mergeSnapshot({
    conversationId: CONV,
    existing,
    raws,
    now: (clock += 1000),
    adapterVersion: 'test',
  });
}

describe('mergeSnapshot：追加与幂等', () => {
  it('验收 1：3 轮 6 条；刷新续写追加不重复', async () => {
    const raws = [
      raw('user', 'Q1', 0, 'u1'),
      raw('assistant', 'A1', 1, 'a1'),
      raw('user', 'Q2', 2, 'u2'),
      raw('assistant', 'A2', 3, 'a2'),
      raw('user', 'Q3', 4, 'u3'),
      raw('assistant', 'A3', 5, 'a3'),
    ];
    const state = await firstMerge(raws);
    expect(state).toHaveLength(6);

    // 刷新后 DOM 重建：同样的 6 条 + 新 1 轮
    const again = await nextMerge(state, [
      ...raws.map((r) => ({ ...r })),
      raw('user', 'Q4', 6, 'u4'),
      raw('assistant', 'A4', 7, 'a4'),
    ]);
    expect(again.inserted).toBe(2);
    expect(again.all).toHaveLength(8);
    // 同快照再跑一遍 → 全部 touch，零新增（幂等）
    const third = await nextMerge(again.all, [
      ...raws.map((r, i) => ({ ...r, domIndex: i })),
      raw('user', 'Q4', 6, 'u4'),
      raw('assistant', 'A4', 7, 'a4'),
    ]);
    expect(third.inserted).toBe(0);
    expect(third.all).toHaveLength(8);
  });

  it('U04：无 ID 平台按位置+角色+内容识别（重渲染不新增）', async () => {
    const raws = [raw('user', '你好', 0), raw('assistant', '你好！', 1)];
    const state = await firstMerge(raws);
    expect(state).toHaveLength(2);
    // 平台无 ID：重渲染后同一批内容
    const again = await nextMerge(state, [raw('user', '你好', 0), raw('assistant', '你好！', 1)]);
    expect(again.inserted).toBe(0);
    expect(again.updated).toBe(0);
    expect(again.all.every((m, i) => m.order === state[i].order)).toBe(true);
  });
});

describe('mergeSnapshot：重复文本消歧（U05）', () => {
  it('连续三条"继续"不合并，重跑不新增', async () => {
    const raws = [
      raw('user', '开始', 0),
      raw('assistant', '好的', 1),
      raw('user', '继续', 2),
      raw('assistant', '第二部分', 3),
      raw('user', '继续', 4),
      raw('assistant', '第三部分', 5),
      raw('user', '继续', 6),
      raw('assistant', '完毕', 7),
    ];
    const state = await firstMerge(raws);
    const gos = state.filter((m) => m.contentText === '继续');
    expect(gos).toHaveLength(3);
    expect(new Set(gos.map((g) => g.msgKey)).size).toBe(3);

    const again = await nextMerge(state, raws.map((r) => ({ ...r })));
    expect(again.inserted).toBe(0);
    expect(again.all.filter((m) => m.contentText === '继续')).toHaveLength(3);
  });
});

describe('mergeSnapshot：历史补录（验收 3 / U06）', () => {
  const all70 = Array.from({ length: 70 }, (_, i) =>
    i % 2 === 0
      ? raw('user', `问题 ${i / 2}`, i)
      : raw('assistant', `回答 ${(i - 1) / 2}`, i),
  );
  const expected = all70.map((r) => r.text);

  it('先存最新 20 条，再补录 50 条历史 → 总数 70、顺序正确、无重复', async () => {
    // 初始只渲染 20..69（索引 50..69）
    const state = await firstMerge(all70.slice(50));
    expect(state).toHaveLength(20);

    // 向上滚动后全量 70 条
    const out = await nextMerge(state, all70.map((r) => ({ ...r })));
    expect(out.inserted).toBe(50);
    expect(out.all).toHaveLength(70);
    expect(out.all.map((m) => m.contentText)).toEqual(expected);
    expect(new Set(out.all.map((m) => m.id)).size).toBe(70);
  });

  it('补录快照与旧快照部分重叠也不重复（20 + 70(含旧20)）', async () => {
    const state = await firstMerge(all70.slice(60)); // 只有 10 条
    const out = await nextMerge(state, all70.map((r) => ({ ...r })));
    expect(out.all).toHaveLength(70);
    expect(out.inserted).toBe(60);
  });

  it('U07：中间插入一条', async () => {
    const base = [raw('user', '一', 0), raw('assistant', '答一', 1), raw('user', '二', 2), raw('assistant', '答二', 3)];
    const state = await firstMerge(base);
    // 新渲染：在"一"之前插入了"零"（整体后移）
    const out = await nextMerge(state, [
      raw('user', '零', 0),
      raw('user', '一', 1),
      raw('assistant', '答一', 2),
      raw('user', '二', 3),
      raw('assistant', '答二', 4),
    ]);
    expect(out.inserted).toBe(1);
    expect(out.all.map((m) => m.contentText)).toEqual(['零', '一', '答一', '二', '答二']);
  });
});

describe('mergeSnapshot：编辑与重新生成（U08/U09）', () => {
  it('U08：同位置同角色高相似 → 更新不新增', async () => {
    const raws = [raw('user', '写个快排', 0), raw('assistant', 'def sort():\n    pass', 1)];
    const state = await firstMerge(raws);
    const edited = 'def sort():\n    pass\n    return x';
    const out = await nextMerge(state, [raw('user', '写个快排', 0), raw('assistant', edited, 1)]);
    expect(out.inserted).toBe(0);
    expect(out.updated).toBe(1);
    expect(out.all.find((m) => m.role === 'assistant')?.contentText).toBe(edited);
  });

  it('U09：重新生成（同平台 ID 全新内容）→ 更新不新增', async () => {
    const raws = [raw('user', '写首诗', 0, 'u1'), raw('assistant', '床前明月光', 1, 'a1')];
    const state = await firstMerge(raws);
    const out = await nextMerge(state, [raw('user', '写首诗', 0, 'u1'), raw('assistant', '完全不一样的内容', 1, 'a1')]);
    expect(out.inserted).toBe(0);
    expect(out.updated).toBe(1);
    expect(out.all).toHaveLength(2);
    expect(out.all.some((m) => m.contentText === '完全不一样的内容')).toBe(true);
  });

  it('无 ID 平台同位置全量改写 → 旧记录保留 + 新增（不丢优先，可手动删旧）', async () => {
    const raws = [raw('user', '写首诗', 0), raw('assistant', '床前明月光', 1)];
    const state = await firstMerge(raws);
    const out = await nextMerge(state, [raw('user', '写首诗', 0), raw('assistant', '完全不一样的内容', 1)]);
    expect(out.all).toHaveLength(3);
    expect(out.all.some((m) => m.contentText === '床前明月光')).toBe(true);
  });
});

describe('mergeSnapshot：平台 ID 更新（U03）', () => {
  it('同 ID 内容变化 → 更新，记录数不变', async () => {
    const raws = [raw('user', '初稿', 0, 'p1'), raw('assistant', '回答', 1, 'p2')];
    const state = await firstMerge(raws);
    const out = await nextMerge(state, [raw('user', '改过的', 0, 'p1'), raw('assistant', '回答', 1, 'p2')]);
    expect(out.inserted).toBe(0);
    expect(out.updated).toBe(1);
    const m = out.all.find((x) => x.platformMessageId === 'p1');
    expect(m?.contentText).toBe('改过的');
    expect(out.all).toHaveLength(2);
  });
});

describe('mergeSnapshot：流式草稿（U10）', () => {
  it('draft → 稳定后 finalize 为 complete，只有一条记录', async () => {
    const part = '这是半个回答';
    const state = await firstMerge([raw('user', '问', 0, 'u1'), raw('assistant', part, 1, 'a1', true)]);
    expect(state.find((m) => m.role === 'assistant')?.status).toBe('draft');

    const final = '这是半个回答，现在完整了';
    const out = await nextMerge(state, [raw('user', '问', 0, 'u1'), raw('assistant', final, 1, 'a1')]);
    expect(out.all.filter((m) => m.role === 'assistant')).toHaveLength(1);
    const m = out.all.find((x) => x.role === 'assistant');
    expect(m?.status).toBe('complete');
    expect(m?.contentText).toBe(final);
  });

  it('内容未变仅状态翻转 → 也会产生一条 update', async () => {
    const text = '同样的内容';
    const state = await firstMerge([raw('assistant', text, 0, undefined, true)]);
    expect(state[0].status).toBe('draft');
    const out = await nextMerge(state, [raw('assistant', text, 0)]);
    expect(out.all[0].status).toBe('complete');
  });
});

describe('mergeSnapshot：边界（U20）', () => {
  it('空文本跳过', async () => {
    const out = await mergeSnapshot({
      conversationId: CONV,
      existing: [],
      raws: [raw('user', '   ', 0), raw('assistant', '有内容', 1)],
      now: clock,
      adapterVersion: 'test',
    });
    expect(out.all).toHaveLength(1);
  });

  it('超长文本截断并标 truncated', async () => {
    const long = 'x'.repeat(300 * 1024);
    const out = await mergeSnapshot({
      conversationId: CONV,
      existing: [],
      raws: [raw('assistant', long, 0)],
      now: clock,
      adapterVersion: 'test',
    });
    expect(out.all[0].truncated).toBe(true);
    expect(out.all[0].contentText.length).toBe(256 * 1024);
  });

  it('同快照内重复平台 ID 只保留第一次', async () => {
    const out = await mergeSnapshot({
      conversationId: CONV,
      existing: [],
      raws: [raw('user', '第一', 0, 'dup'), raw('user', '第二', 1, 'dup')],
      now: clock,
      adapterVersion: 'test',
    });
    expect(out.all).toHaveLength(1);
    expect(out.all[0].contentText).toBe('第一');
  });
});

describe('mergeSnapshot：顺序号保持', () => {
  it('纯追加时旧消息 order 不变', async () => {
    const raws = [raw('user', '一', 0), raw('assistant', '甲', 1)];
    const state = await firstMerge(raws);
    const oldOrders = state.map((m) => m.order);
    const out = await nextMerge(state, [...raws.map((r) => ({ ...r })), raw('user', '二', 2), raw('assistant', '乙', 3)]);
    const still = out.all.filter((m) => ['一', '甲'].includes(m.contentText));
    expect(still.map((m) => m.order)).toEqual(oldOrders);
    expect(out.renumbered).toBe(false);
    expect(initialOrder(0)).toBeLessThan(out.all[2].order);
  });
});
