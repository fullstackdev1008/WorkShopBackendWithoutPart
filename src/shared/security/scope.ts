// ─── Shared Scope Engine ──────────────────────────────────────────────────────
//
// Record-level scoping that sits ON TOP of RBAC — it never authorizes and never
// replaces checkPermission/authorize. It runs only AFTER a permission check has
// already passed, and narrows *which records* an already-permitted user may see
// or act on.
//
// Two operations:
//   • filter builders  → a SQL condition to AND into a list/read WHERE
//                        (undefined = no restriction → caller adds nothing)
//   • assertions       → guard a single fetched record (the IDOR boundary);
//                        throw ForbiddenError when out of scope, no-op on bypass
//
// Bypass is centralised here: super-admin, shopScope = 'ALL', and
// warrantyOnly = false all resolve to "no restriction", so callers never
// special-case them.

import type { FastifyRequest } from 'fastify';
import { eq, sql, inArray, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { users, vehicleCheckIns, jobCards, vehicles } from '../../db/models';
import { AppError, ForbiddenError } from '../errors/appError';
import { getCachedScope, setCachedScope } from './scopeCache';

// Canonical warranty service-type code (used by appointments).
export const WARRANTY_SERVICE_CODE = 'WARRANTY_SERVICE';

// IMPORTANT: job cards store the service-type DISPLAY NAME ("Warranty Service")
// — the job-card builder writes `serviceType = option.name` (see JobRow) —
// whereas appointments store the CODE ("WARRANTY_SERVICE"). To identify a
// warranty job card robustly we accept BOTH representations.
export const WARRANTY_SERVICE_VALUES = ['Warranty Service', 'WARRANTY_SERVICE'];

function isWarrantyServiceType(serviceType?: string | null): boolean {
  if (!serviceType) return false;
  const v = serviceType.trim().toLowerCase();
  return WARRANTY_SERVICE_VALUES.some((x) => x.toLowerCase() === v);
}

export type ShopScope = 'SERVICE' | 'MAJOR' | 'PDI' | 'ALL'; // user-side
export type CheckInShop = 'SERVICE' | 'MAJOR' | 'PDI'; // record-side

export interface UserScope {
  userId: string;
  isSuperAdmin: boolean;
  shopScope: ShopScope;
  warrantyOnly: boolean;
}

// Resolve the caller's scope once per request. Reads from the per-user cache
// (5-min TTL) and falls back to a single DB lookup. Scope is NOT trusted from
// the JWT (a long-lived token would let a revoked scope linger) — it is looked
// up fresh + cached, exactly like role permissions.
export async function resolveUserScope(request: FastifyRequest): Promise<UserScope> {
  if (!request.user) {
    throw new AppError(401, 'Authentication required.');
  }
  const { userId, roleSlug } = request.user;
  const isSuperAdmin = roleSlug === 'super-admin';

  let cached = getCachedScope(userId);
  if (!cached) {
    const [row] = await db
      .select({ shopScope: users.shopScope, warrantyOnly: users.warrantyOnly })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    cached = {
      shopScope: (row?.shopScope as ShopScope) ?? 'ALL',
      warrantyOnly: row?.warrantyOnly ?? false,
    };
    setCachedScope(userId, cached);
  }

  return { userId, isSuperAdmin, shopScope: cached.shopScope, warrantyOnly: cached.warrantyOnly };
}

// ─── Bypass predicates ─────────────────────────────────────────────────────────
function shopUnrestricted(scope: UserScope): boolean {
  return scope.isSuperAdmin || scope.shopScope === 'ALL';
}
function warrantyUnrestricted(scope: UserScope): boolean {
  return scope.isSuperAdmin || !scope.warrantyOnly;
}

// ─── Filter builders (list/read queries) ────────────────────────────────────────
// Return undefined when the user is unrestricted, so callers can safely do:
//   .where(and(<existing conditions>, shopFilter(scope)))
// (drizzle's and() ignores undefined). Filtering on the check-in spine means
// the caller's query must include the vehicle_check_ins table (directly or via
// a join from job_cards.vehicle_check_in_id).
export function shopFilter(scope: UserScope): SQL | undefined {
  if (shopUnrestricted(scope)) return undefined;
  return eq(vehicleCheckIns.shop, scope.shopScope as CheckInShop);
}

export function warrantyFilter(scope: UserScope): SQL | undefined {
  if (warrantyUnrestricted(scope)) return undefined;
  return inArray(jobCards.serviceType, WARRANTY_SERVICE_VALUES);
}

// For vehicle-centric queries (e.g. the Service Advisor dashboard, which lists
// `vehicles` by status rather than check-ins). A vehicle is in the caller's
// shop iff it has an ACTIVE check-in tagged with that shop. Returns undefined
// when unrestricted. Correlated EXISTS subquery against the check-in spine.
export function shopVehicleFilter(scope: UserScope): SQL | undefined {
  if (shopUnrestricted(scope)) return undefined;
  return sql`EXISTS (SELECT 1 FROM ${vehicleCheckIns}
    WHERE ${vehicleCheckIns.vehicleId} = ${vehicles.id}
      AND ${vehicleCheckIns.isActive} = true
      AND ${vehicleCheckIns.shop}::text = ${scope.shopScope})`;
}

// Warranty equivalent for the vehicle-centric Service Advisor dashboard. A
// vehicle appears for a warranty-only clerk iff it has a WARRANTY_SERVICE job
// card. Returns undefined when the caller is not warranty-restricted.
export function warrantyVehicleFilter(scope: UserScope): SQL | undefined {
  if (warrantyUnrestricted(scope)) return undefined;
  return sql`EXISTS (SELECT 1 FROM ${jobCards}
    WHERE ${jobCards.vehicleId} = ${vehicles.id}
      AND ${jobCards.serviceType} IN ('Warranty Service', 'WARRANTY_SERVICE'))`;
}

// ─── Single-record predicates (IDOR guards) ──────────────────────────────────────
// A null/undefined marker is treated as out-of-scope for restricted users
// (fail-closed) — an un-tagged record is hidden rather than leaked.
//
// Two flavours are provided:
//   • boolean predicates (checkInInScope / warrantyInScope) — for the SERVICE
//     layer, which uses return-style errors: `if (!checkInInScope(...)) return
//     error(HttpStatus.FORBIDDEN, ...)`. A thrown error there would be masked
//     as HTTP 500 by the surrounding try/catch.
//   • throwing assertions (assert*) — for route/middleware-level use, where
//     Fastify's errorHandler renders AppError/ForbiddenError correctly.
export function checkInInScope(scope: UserScope, checkInShop: CheckInShop | null | undefined): boolean {
  if (shopUnrestricted(scope)) return true;
  return !!checkInShop && checkInShop === scope.shopScope;
}

export function warrantyInScope(scope: UserScope, serviceType: string | null | undefined): boolean {
  if (warrantyUnrestricted(scope)) return true;
  return isWarrantyServiceType(serviceType);
}

export function jobCardInScope(
  scope: UserScope,
  record: { checkInShop?: CheckInShop | null; serviceType?: string | null },
): boolean {
  return (
    checkInInScope(scope, record.checkInShop ?? null) &&
    warrantyInScope(scope, record.serviceType ?? null)
  );
}

export function assertCheckInInScope(scope: UserScope, checkInShop: CheckInShop | null | undefined): void {
  if (!checkInInScope(scope, checkInShop)) {
    throw new ForbiddenError('Access denied: this record belongs to another shop.');
  }
}

export function assertWarrantyInScope(scope: UserScope, serviceType: string | null | undefined): void {
  if (!warrantyInScope(scope, serviceType)) {
    throw new ForbiddenError('Access denied: this job card is not a warranty job.');
  }
}

export function assertJobCardInScope(
  scope: UserScope,
  record: { checkInShop?: CheckInShop | null; serviceType?: string | null },
): void {
  if (!jobCardInScope(scope, record)) {
    throw new ForbiddenError('Access denied: this job card is outside your scope.');
  }
}

// Re-exported so callers (e.g. user-management updateUser) invalidate via one import.
export { invalidateScopeCache } from './scopeCache';
