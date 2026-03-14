import { cache } from "react";

/**
 * Per-request context using React cache().
 * In RSC, cache() is request-scoped — the first call initializes the context,
 * and subsequent calls within the same request (even across Suspense boundaries)
 * return the same object.
 *
 * PRODUCTION NOTE (AsyncLocalStorage-based hierarchy tracking):
 * In a production implementation, you could use AsyncLocalStorage to automatically
 * track the suspense boundary hierarchy without explicit path props:
 *
 *   const boundaryContext = new AsyncLocalStorage<{
 *     path: string;
 *     requestStartTs: number;
 *   }>();
 *
 * Each TracedBoundary would read its parent path from ALS, append its own name,
 * and create new context for children via boundaryContext.run(). This works when
 * React's RSC renderer processes child components within the parent's async
 * execution context. However, this depends on React internals and may not be
 * reliable across all Suspense boundary configurations.
 *
 * For this prototype, we use explicit boundary paths for reliability.
 */

export interface RequestContext {
  requestId: string;
  requestStartTs: number;
  slowMode: boolean;
}

export const getRequestContext = cache((): RequestContext => ({
  requestId: crypto.randomUUID(),
  requestStartTs: Date.now(),
  slowMode: false,
}));
