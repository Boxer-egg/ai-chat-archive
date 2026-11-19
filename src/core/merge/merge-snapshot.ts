/**
 * 核心合并引擎（技术方案 §6 + §7）：对齐 → 去重 → 插队 → 顺序号。
 * 幂等：同一快照重复执行结果一致（msgKey 确定性 + 内容比对）。
 *
 * 身份规则：
 * - 平台 ID 键（p:…）稳定不变；
 * - 指纹键（f:…）消息内容变更时重键为新指纹，保证下次快照仍能 diff 命中（否则历史插入会制造重复）。
 */
import type { Message, RawMessage } from '../types';
import { LIMITS, ORDER_GAP, TIMING } from '../../shared/constants';
import { contentHash, fingerprint, msgKeyFor, normalize } from './fingerprint';
import { diffMatch } from './diff';
import { initialOrder, renumber } from './order';

export interface MergeInput {
  conversationId: string;
  /** 已有消息，按 order 排序 */
  existing: Message[];
  /** 本次扫描到的消息，DOM 顺序 */
  raws: RawMessage[];
  now: number;
  adapterVersion: string;
}

export interface RekeyedUpdate {
  /** 旧记录（需要 delete） */
  old: Message;
  /** 新记录（需要 put，id/msgKey 可能已变） */
  next: Message;
}

export interface MergeOutput {
  inserts: Message[];
  updates: RekeyedUpdate[];
  /** 内容未变、只需刷新 savedAt/domIndex/status 的完整记录 */
  touches: Message[];
  /** 最终完整顺序（若重排过则为重排后） */
  all: Message[];
  renumbered: boolean;
  inserted: number;
  updated: number;
}

interface Prepared {
  raw: RawMessage;
  hash: string;
  fp: string;
  index: number;
}

/** 行级 Dice 相似度，用于"编辑检测"（同位置同角色但内容大改） */
export function similarity(a: string, b: string): number {
  const la = normalize(a).split('\n').filter((l) => l.length > 0);
  const lb = normalize(b).split('\n').filter((l) => l.length > 0);
  if (la.length === 0 && lb.length === 0) return 1;
  const count = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const l of arr) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const ca = count(la);
  const cb = count(lb);
  let overlap = 0;
  for (const [k, v] of ca) overlap += Math.min(v, cb.get(k) ?? 0);
  return (2 * overlap) / (la.length + lb.length);
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= LIMITS.MESSAGE_TEXT_MAX) return { text, truncated: false };
  return { text: text.slice(0, LIMITS.MESSAGE_TEXT_MAX), truncated: true };
}

export async function mergeSnapshot(input: MergeInput): Promise<MergeOutput> {
  const { conversationId, existing, raws, now, adapterVersion } = input;

  // 0) 预处理：规范化 + 哈希。同快照内重复 pid 只保留第一次出现。
  const seenPid = new Set<string>();
  const prepared: Prepared[] = [];
  for (const raw of raws) {
    if (raw.text.trim().length === 0) continue; // 空文本跳过（U20）
    if (raw.platformMessageId) {
      const pidKey = `${raw.platformMessageId}:${raw.role}`;
      if (seenPid.has(pidKey)) continue;
      seenPid.add(pidKey);
    }
    const hash = await contentHash(raw.text);
    const fp = await fingerprint(raw.role, raw.text);
    prepared.push({ raw, hash, fp, index: prepared.length });
  }

  // 指纹池：指纹键消息与新增消息从这里按序消费 occurrence 序号（"继续"×3 → #0/#1/#2）
  const fpPool = new Map<string, number>();
  for (const m of existing) fpPool.set(m.fingerprint, (fpPool.get(m.fingerprint) ?? 0) + 1);
  const takeFpKey = (fp: string): string => {
    const n = fpPool.get(fp) ?? 0;
    fpPool.set(fp, n + 1);
    return msgKeyFor(undefined, fp, n);
  };

  const byPid = new Map<string, Message>();
  for (const m of existing) {
    if (m.platformMessageId) byPid.set(`${m.platformMessageId}:${m.role}`, m);
  }

  const used = new Set<string>();
  const matched = new Map<number, Message>(); // prepared.index -> existing
  const rekeys: Array<{ p: Prepared; m: Message }> = [];
  const touches: Message[] = [];

  const newStatus = (p: Prepared, m: Message): Message['status'] =>
    p.raw.streaming ? 'draft' : m.status === 'draft' ? 'complete' : m.status;

  /** 内容变化时构造新记录（指纹键消息可能重键） */
  const buildNext = (p: Prepared, m: Message): Message => {
    const { text, truncated } = truncate(p.raw.text);
    const isFpKey = m.msgKey.startsWith('f:');
    const key = isFpKey ? takeFpKey(p.fp) : m.msgKey;
    return {
      ...m,
      id: `${conversationId}#${key}`,
      msgKey: key,
      contentText: text,
      contentHtml: p.raw.html,
      contentHash: p.hash,
      fingerprint: p.fp,
      status: newStatus(p, m),
      truncated: truncated || undefined,
      domIndex: p.raw.domIndex,
      model: p.raw.model ?? m.model,
      updatedAt: now,
      adapterVersion,
    };
  };

  const markMatched = (p: Prepared, m: Message) => {
    matched.set(p.index, m);
    used.add(m.id);
    const status = newStatus(p, m);
    const modelChanged = p.raw.model !== undefined && p.raw.model !== m.model;
    if (m.contentHash !== p.hash || status !== m.status || modelChanged) {
      rekeys.push({ p, m });
    } else {
      // 内容未变：只在位置移动或距上次落库超过 TOUCH_REFRESH_MS 时才写回，
      // 避免流式期间每次快照都整批 put 未变化的消息
      const moved = m.domIndex !== p.raw.domIndex;
      const stale = now - m.savedAt >= TIMING.TOUCH_REFRESH_MS;
      if (moved || stale) {
        touches.push({ ...m, domIndex: p.raw.domIndex, savedAt: now });
      }
    }
  };

  // 1) 级别 1：平台消息 ID 精确匹配
  const rest: Prepared[] = [];
  for (const p of prepared) {
    const m = p.raw.platformMessageId ? byPid.get(`${p.raw.platformMessageId}:${p.raw.role}`) : undefined;
    if (m && !used.has(m.id)) markMatched(p, m);
    else rest.push(p);
  }

  // 2) 级别 2/3：对剩余部分做 Myers diff（序列为 角色+文本 指纹；相同文本按出现次序自然配对）
  const restExisting = existing.filter((m) => !used.has(m.id));
  const capped = restExisting.length > LIMITS.ALIGN_MAX;
  const existingWindow = capped ? restExisting.slice(-LIMITS.ALIGN_MAX) : restExisting;
  const pairs = diffMatch(
    existingWindow.map((m) => m.fingerprint),
    rest.map((p) => p.fp),
  );
  for (const { aIndex, bIndex } of pairs) {
    const m = existingWindow[aIndex];
    const p = rest[bIndex];
    if (used.has(m.id) || matched.has(p.index)) continue;
    markMatched(p, m);
  }

  // 3) 级别 4：同位置同角色 + 高相似度 → 判为编辑（更新而非新增）
  for (const p of rest) {
    if (matched.has(p.index)) continue;
    const candidate = existing.find((m) => !used.has(m.id) && m.domIndex === p.raw.domIndex);
    if (candidate && candidate.role === p.raw.role && similarity(candidate.contentText, p.raw.text) >= 0.6) {
      markMatched(p, candidate);
    }
  }

  // 4) 组装最终顺序：existing 顺序 + 按锚点插入新消息
  const existingIndex = new Map<string, number>();
  existing.forEach((m, i) => existingIndex.set(m.id, i));
  const anchors = new Map<number, number>(); // prepared.index -> existing 下标
  for (const [pi, m] of matched) anchors.set(pi, existingIndex.get(m.id)!);

  interface SlotItem {
    p: Prepared;
    prev: number; // existing 下标，-1 = 最前
    next: number; // existing 下标，len = 最后
  }
  const slots = new Map<string, SlotItem[]>(); // "prev:next" -> 新消息（prepared 顺序）
  const slotOf = (p: Prepared): string => {
    let prev = -1;
    let next = existing.length;
    for (let pi = p.index - 1; pi >= 0; pi--) {
      const a = anchors.get(pi);
      if (a !== undefined) {
        prev = a;
        break;
      }
    }
    for (let pi = p.index + 1; pi < prepared.length; pi++) {
      const a = anchors.get(pi);
      if (a !== undefined) {
        next = a;
        break;
      }
    }
    return `${prev}:${next}`;
  };
  for (const p of prepared) {
    if (matched.has(p.index)) continue;
    const k = slotOf(p);
    const arr = slots.get(k) ?? [];
    arr.push({ p, prev: Number(k.split(':')[0]), next: Number(k.split(':')[1]) });
    slots.set(k, arr);
  }

  // 5) 为每个槽内的新消息分配序号（槽内均匀铺开），精度耗尽 → 整段重排
  const ordersBySlot = new Map<string, number[]>();
  let needRenumber = false;
  if (existing.length === 0) {
    // 全新会话：直接顺序号
    const items = [...slots.values()].flat().sort((a, b) => a.p.index - b.p.index);
    items.forEach((it, i) => {
      const k = slotOf(it.p);
      const arr = ordersBySlot.get(k) ?? [];
      arr.push(initialOrder(i));
      ordersBySlot.set(k, arr);
    });
  } else {
    for (const [k, items] of slots) {
      const prev = items[0].prev;
      const next = items[0].next;
      const prevOrder =
        prev >= 0 ? existing[prev].order : existing[0].order - ORDER_GAP;
      const nextOrder =
        next < existing.length ? existing[next].order : existing[existing.length - 1].order + ORDER_GAP;
      const k2 = items.length + 1;
      const step = (nextOrder - prevOrder) / k2;
      const orders = items.map((_, i) => prevOrder + step * (i + 1));
      if (orders.some((o) => Number.isNaN(o) || o <= prevOrder || o >= nextOrder)) {
        needRenumber = true;
      }
      ordersBySlot.set(k, orders);
    }
  }

  let all: Message[];
  if (needRenumber) {
    // 先构造完整序列（新消息 order 占位），再统一重排
    const seq = [...existing];
    const splices: Array<{ pos: number; items: Message[] }> = [];
    for (const [k, items] of slots) {
      const [ps] = k.split(':').map(Number);
      splices.push({
        pos: ps + 1,
        items: items.map((it) => buildInsert(it.p, 0)),
      });
    }
    splices.sort((a, b) => b.pos - a.pos);
    for (const { pos, items } of splices) seq.splice(pos, 0, ...items);
    all = renumber(seq);
  } else {
    all = [...existing];
    const splices: Array<{ pos: number; items: Message[] }> = [];
    for (const [k, items] of slots) {
      const [ps] = k.split(':').map(Number);
      const orders = ordersBySlot.get(k)!;
      splices.push({
        pos: ps + 1,
        items: items.map((it, i) => buildInsert(it.p, orders[i])),
      });
    }
    splices.sort((a, b) => b.pos - a.pos);
    for (const { pos, items } of splices) all.splice(pos, 0, ...items);
  }

  function buildInsert(p: Prepared, order: number): Message {
    const { text, truncated } = truncate(p.raw.text);
    const key = p.raw.platformMessageId
      ? msgKeyFor(p.raw.platformMessageId, p.fp, 0, p.raw.role)
      : takeFpKey(p.fp);
    return {
      id: `${conversationId}#${key}`,
      conversationId,
      msgKey: key,
      platformMessageId: p.raw.platformMessageId,
      role: p.raw.role,
      contentText: text,
      contentHtml: p.raw.html,
      order,
      timestamp: p.raw.timestamp,
      fingerprint: p.fp,
      contentHash: p.hash,
      status: p.raw.streaming ? 'draft' : 'complete',
      truncated: truncated || undefined,
      domIndex: p.raw.domIndex,
      model: p.raw.model,
      savedAt: now,
      updatedAt: now,
      adapterVersion,
    };
  }

  // 6) 汇总变更。重排后 updates/touches 的 order 以 all 为准。
  const finalById = new Map(all.map((m) => [m.id, m]));
  const orderOf = (id: string, fallback: number) => finalById.get(id)?.order ?? fallback;

  const updates: RekeyedUpdate[] = rekeys.map(({ p, m }) => {
    const next = buildNext(p, m);
    next.order = finalById.get(next.id)?.order ?? finalById.get(m.id)?.order ?? m.order;
    return { old: m, next };
  });

  // all 反映更新后的最终状态（调用方把它当作"最终顺序"）
  if (updates.length > 0) {
    const byOldId = new Map(updates.map((u) => [u.old.id, u.next]));
    all = all.map((m) => byOldId.get(m.id) ?? m);
  }
  const finalTouches = touches.map((m) => ({
    ...m,
    order: orderOf(m.id, m.order),
  }));

  const knownIds = new Set([
    ...existingIndex.keys(),
    ...updates.map((u) => u.next.id),
  ]);
  const inserts = all.filter((m) => !knownIds.has(m.id));

  return {
    inserts,
    updates,
    touches: finalTouches,
    all,
    renumbered: needRenumber,
    inserted: inserts.length,
    updated: updates.length,
  };
}
