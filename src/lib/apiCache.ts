interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * A simple in-memory TTL cache for server-side API routes, to avoid
 * re-billing identical requests to paid external APIs. This app runs as a
 * persistent `next start` Node process (not serverless), so a module-level
 * cache like this actually persists across requests -- it resets on
 * restart/redeploy and isn't shared across multiple server instances, which
 * is fine at this scale but worth knowing if that ever changes.
 */
export class ApiCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries: number = 500
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
