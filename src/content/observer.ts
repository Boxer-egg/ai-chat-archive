/** 防抖 / 节流工具 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args: A) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!pending) {
      pending = setTimeout(
        () => {
          pending = undefined;
          last = Date.now();
          fn(...args);
        },
        ms - (now - last),
      );
    }
  };
}
