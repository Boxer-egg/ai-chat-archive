/**
 * 选择器配置化（技术方案 §4.3）：候选列表按序尝试，全部落空记入 misses，不抛错。
 * 硬性规则：平台选择器只允许出现在 content/adapters/ 内。
 */
export interface SelectorSpec {
  /** 语义名，日志/诊断用 */
  name: string;
  /** 从最稳到最不稳，按顺序尝试 */
  selectors: string[];
  /** required 全部失败 → diagnose 至少 degraded */
  required?: boolean;
}

/** 在 root 下按序尝试候选选择器，返回第一个命中的元素 */
export function pick(root: ParentNode, spec: SelectorSpec, misses: string[]): Element | null {
  for (const sel of spec.selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      /* 无效选择器不应让整页失效 */
    }
  }
  misses.push(spec.name);
  return null;
}

/** 返回所有命中的节点（取第一个非空候选） */
export function pickAll(root: ParentNode, spec: SelectorSpec, misses: string[]): Element[] {
  for (const sel of spec.selectors) {
    try {
      const list = Array.from(root.querySelectorAll(sel));
      if (list.length > 0) return list;
    } catch {
      /* ignore */
    }
  }
  misses.push(spec.name);
  return [];
}
