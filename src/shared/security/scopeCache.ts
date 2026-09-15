// Per-user scope cache. Mirrors permissionsCache (5-min TTL + explicit
// invalidation) so a scope change takes effect promptly without a per-request
// DB read. Keyed by userId because scope is a user attribute (unlike
// permissions, which are cached per roleId).

const TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CachedScope {
  shopScope: 'SERVICE' | 'MAJOR' | 'PDI' | 'ALL';
  warrantyOnly: boolean;
}

interface CacheEntry extends CachedScope {
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedScope(userId: string): CachedScope | null {
  const entry = cache.get(userId);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(userId);
    return null;
  }
  return { shopScope: entry.shopScope, warrantyOnly: entry.warrantyOnly };
}

export function setCachedScope(userId: string, scope: CachedScope): void {
  cache.set(userId, { ...scope, expiresAt: Date.now() + TTL_MS });
}

export function invalidateScopeCache(userId: string): void {
  cache.delete(userId);
}
