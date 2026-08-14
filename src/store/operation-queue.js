/**
 * Small FIFO queue for store operations.
 *
 * Reads and writes share one queue so a scan cannot observe a half-finished
 * migration, snapshot save, or prune. A failed operation rejects only its own
 * promise; the queue remains usable for later work.
 */
export function createOperationQueue() {
  let tail = Promise.resolve();
  let pending = 0;
  let activeLabel = null;

  function enqueue(label, operation) {
    if (typeof operation !== 'function') {
      throw new TypeError('operation must be a function');
    }

    pending += 1;
    const result = tail.then(async () => {
      activeLabel = String(label || 'store-operation');
      try {
        return await operation();
      } finally {
        activeLabel = null;
      }
    });

    // Keep the scheduling chain fulfilled so one rejection never poisons the
    // operations behind it. Callers still receive the original rejection.
    tail = result.then(
      () => { pending -= 1; },
      () => { pending -= 1; },
    );
    return result;
  }

  return {
    enqueue,
    whenIdle: () => tail,
    get pending() { return pending; },
    get activeLabel() { return activeLabel; },
  };
}
