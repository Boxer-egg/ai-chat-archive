/**
 * 流式草稿状态机（技术方案 §6.6）：
 * 流式期间节流写 draft；停止后静默 1200ms finalize。
 */
import { TIMING } from '../shared/constants';

export class DraftTracker {
  private lastWrite = 0;
  private lastText = '';
  private stableTimer: ReturnType<typeof setTimeout> | undefined;
  private lastStreaming = false;

  /** 返回 'write-draft' | 'skip' | 'finalize' */
  onSnapshot(streaming: boolean, text: string, now = Date.now()): 'write-draft' | 'skip' | 'finalize' {
    if (streaming) {
      this.lastStreaming = true;
      clearTimeout(this.stableTimer);
      const delta = Math.abs(text.length - this.lastText.length);
      if (now - this.lastWrite >= TIMING.STREAM_THROTTLE_MS && delta >= STREAM_MIN_DELTA) {
        this.lastWrite = now;
        this.lastText = text;
        return 'write-draft';
      }
      return 'skip';
    }
    // 非流式
    if (this.lastStreaming) {
      // 刚从流式结束：等静默期后 finalize
      clearTimeout(this.stableTimer);
      this.stableTimer = setTimeout(() => {}, TIMING.STABLE_MS);
      this.lastStreaming = false;
      return 'finalize';
    }
    return 'finalize';
  }

  reset(): void {
    clearTimeout(this.stableTimer);
    this.lastWrite = 0;
    this.lastText = '';
    this.lastStreaming = false;
  }
}

const STREAM_MIN_DELTA = TIMING.STREAM_MIN_DELTA;
