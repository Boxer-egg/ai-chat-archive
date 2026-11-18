/** 按 conversationId 的串行队列（技术方案 §6.4：单写者 + 串行，幂等兜住重试） */
export class SyncQueue {
  private chains = new Map<string, Promise<unknown>>();

  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(task, task); // 上一个失败不阻断后续
    this.chains.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }
}
