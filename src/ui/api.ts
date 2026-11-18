/** UI 侧协议客户端（扩展页/弹窗 → SW / 内容脚本） */
import { PROTOCOL, type ProtocolMessage, type Settings } from '../core/protocol';

export async function send<T>(msg: ProtocolMessage): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as T & { error?: string };
  if (res && typeof res === 'object' && 'error' in res && res.error) {
    throw new Error(res.error);
  }
  return res;
}

/** 向当前标签页的内容脚本发消息（弹窗用） */
export async function sendToTab<T>(tabId: number, msg: ProtocolMessage): Promise<T> {
  return chrome.tabs.sendMessage(tabId, msg) as Promise<T>;
}

export async function currentTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

export const api = {
  getSettings: () => send<Settings>({ type: PROTOCOL.GET_SETTINGS }),
  setSettings: (patch: Partial<Settings>) => send<Settings>({ type: PROTOCOL.SET_SETTINGS, patch } as ProtocolMessage),
  listAccounts: () => send({ type: PROTOCOL.LIST_ACCOUNTS } as ProtocolMessage),
  listConversations: (filter?: { platform?: string; accountKey?: string }) =>
    send({ type: PROTOCOL.LIST_CONVERSATIONS, filter } as ProtocolMessage),
  getMessages: (conversationId: string) => send({ type: PROTOCOL.GET_MESSAGES, conversationId } as ProtocolMessage),
  search: (request: unknown) => send({ type: PROTOCOL.SEARCH_MESSAGES, request } as ProtocolMessage),
  deleteConversation: (conversationId: string) => send({ type: PROTOCOL.DELETE_CONVERSATION, conversationId } as ProtocolMessage),
  clearAll: () => send({ type: PROTOCOL.CLEAR_ALL } as ProtocolMessage),
  exportJson: (conversationId?: string) => send({ type: PROTOCOL.EXPORT_JSON, conversationId } as ProtocolMessage),
  exportMarkdown: (conversationId?: string) => send({ type: PROTOCOL.EXPORT_MARKDOWN, conversationId } as ProtocolMessage),
  importPreview: (backupJson: string) => send({ type: PROTOCOL.IMPORT_PREVIEW, backupJson } as ProtocolMessage),
  importApply: (backupJson: string) => send({ type: PROTOCOL.IMPORT_APPLY, backupJson } as ProtocolMessage),
};
