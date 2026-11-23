/**
 * 通用提取流水线（技术方案 §2.2 第 2 步）：调 adapter 扫描 → RawMessage[]。
 * 平台无关；解析失败计入 misses，不抛错。
 */
import type { AdapterContext, PlatformAdapter, RawMessage } from '../core/types';

export interface ExtractResult {
  raws: RawMessage[];
  parseFailures: number;
  messageCount: number;
}

export function extractSnapshot(adapter: PlatformAdapter, ctx: AdapterContext): ExtractResult {
  // 采集前准备：展开懒渲染的折叠面板（异步渲染，下一波快照提取内容）
  try {
    adapter.prepareForSnapshot?.(ctx);
  } catch {
    /* 准备失败不阻断采集 */
  }
  const nodes = adapter.getMessageNodes(ctx);
  const raws: RawMessage[] = [];
  let parseFailures = 0;
  for (let i = 0; i < nodes.length; i++) {
    try {
      // 复用同一份 nodes：parseMessage 内部不再重复全量查询 DOM
      const r = adapter.parseMessage(nodes[i], ctx, { nodes, index: i });
      if (r) raws.push(r);
      else parseFailures++;
    } catch {
      parseFailures++;
    }
  }
  return { raws, parseFailures, messageCount: nodes.length };
}
