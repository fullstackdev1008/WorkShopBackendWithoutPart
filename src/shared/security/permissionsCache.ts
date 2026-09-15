const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  perms: Set<string>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedPermissions(roleId: string): Set<string> | null {
  const entry = cache.get(roleId);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(roleId);
    return null;
  }
  return entry.perms;
}

export function setCachedPermissions(roleId: string, perms: Set<string>): void {
  cache.set(roleId, { perms, expiresAt: Date.now() + TTL_MS });
}

export function invalidatePermissionsCache(roleId: string): void {
  cache.delete(roleId);
}
