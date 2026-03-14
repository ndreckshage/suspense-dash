/**
 * Synchronously blocks the Node.js event loop for the given duration.
 *
 * This simulates expensive sync rendering work (JSX → HTML serialization)
 * that genuinely holds the thread, preventing other Suspense boundaries
 * from rendering even if their data is ready.
 */
export function busyWait(ms: number): void {
  if (ms <= 0) return;
  const start = Date.now();
  while (Date.now() - start < ms) {
    // intentionally blocking the thread
  }
}
