/** id → adapter 注册表（新增平台只改这里 + manifest.ts） */
import type { PlatformAdapter, PlatformId } from '../../core/types';
import { deepseekAdapter } from './deepseek';
import { claudeAdapter } from './claude';
import { kimiAdapter } from './kimi';
import { grokAdapter } from './grok';
import { chatgptAdapter } from './chatgpt';

const REGISTRY = new Map<PlatformId, PlatformAdapter>([
  ['deepseek', deepseekAdapter],
  ['claude', claudeAdapter],
  ['kimi', kimiAdapter],
  ['grok', grokAdapter],
  ['chatgpt', chatgptAdapter],
]);

export function getAdapter(id: PlatformId): PlatformAdapter | undefined {
  return REGISTRY.get(id);
}

export function adapterForUrl(url: URL): PlatformAdapter | null {
  for (const adapter of REGISTRY.values()) {
    try {
      if (adapter.match(url)) return adapter;
    } catch {
      /* match 不应抛错 */
    }
  }
  return null;
}
