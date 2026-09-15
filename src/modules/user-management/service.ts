import { FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq, count, and, ne, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import { users, roles, permissions, designations } from '../../db/models';
import {
  createRoleSchema,
  updateRoleSchema,
  roleIdParamSchema,
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
} from './dto';
import { invalidatePermissionsCache } from '../../shared/security/permissionsCache';
import { invalidateScopeCache } from '../../shared/security/scope';
import { handleSingleFileUpload, deleteFile } from '../../shared/upload/upload';
import { signUrl } from '../../middleware/s3';

// ─── Upload a user avatar (admin) ────────────────────────────────────────────
// Stores the image via the shared upload util and returns its path + signed URL.
// The caller (Add/Edit User form) then submits avatarUrl=path with the user save.
export async function uploadUserAvatar(request: FastifyRequest) {
  try {
    let uploaded;
    try {
      uploaded = (await handleSingleFileUpload(request)).file;
    } catch (e) {
      return error(HttpStatus.BAD_REQUEST, (e as Error)?.message ?? 'Invalid image upload');
    }
    return success('Avatar uploaded', { path: uploaded.path, url: await signUrl(uploaded.path) });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
import { success, error, created, serverError } from '../../shared/http/response';
import { sendWelcomeEmail } from '../../services/email.service';
import { fetchActiveTechnicians, fetchActiveServiceAdvisors } from '../../services/masterDataSync.service';
import { setEvolveTechnicianNoSchema, setEvolveSaNumberSchema } from './dto';
import { env } from '../../config/env';
import { HttpStatus } from '../../shared/http/status';

// ─── Roles ───────────────────────────────────────────────────────────────────

export async function listRoles(request: FastifyRequest) {
  try {
    const q = (request.query ?? {}) as any;
    const paginated = q.page != null || q.limit != null;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db
      .select({ total: count() })
      .from(roles);

    const baseQuery = db
      .select({
        id: roles.id,
        name: roles.name,
        slug: roles.slug,
        isActive: roles.isActive,
        createdAt: roles.createdAt,
      })
      .from(roles)
      .orderBy(roles.createdAt);

    const pagedRoles = paginated
      ? await baseQuery.limit(limit).offset(offset)
      : await baseQuery;

    // Count active (non-deleted) users per role
    const userCounts = await db
      .select({ roleId: users.roleId, total: count() })
      .from(users)
      .where(eq(users.isDeleted, false))
      .groupBy(users.roleId);

    const countMap = new Map(userCounts.map((r: any) => [r.roleId, Number(r.total)]));

    const data = pagedRoles.map((role: any) => ({
      ...role,
      userCount: countMap.get(role.id) ?? 0,
    }));

    if (!paginated) {
      return success('Roles fetched successfully', data);
    }

    const totalNum = Number(total) || 0;
    return success('Roles fetched successfully', {
      data,
      pagination: {
        page,
        limit,
        total: totalNum,
        totalPages: Math.max(1, Math.ceil(totalNum / limit)),
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function createRole(request: FastifyRequest) {
  try {
    const body = request.body as any;

    // Check slug uniqueness
    const [existing] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.slug, body.slug))
      .limit(1);

    if (existing) {
      return error(HttpStatus.BAD_REQUEST, `Role with slug "${body.slug}" already exists`);
    }

    const [newRole] = await db
      .insert(roles)
      .values({ name: body.name, slug: body.slug })
      .returning({ id: roles.id, name: roles.name, slug: roles.slug, isActive: roles.isActive, createdAt: roles.createdAt });

    return created('Role created successfully', newRole);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function updateRole(request: FastifyRequest) {
  try {
    const { roleId } = request.params as any;
    const body = request.body as any;

    const [role] = await db
      .select({ id: roles.id, slug: roles.slug })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);

    if (!role) {
      return error(HttpStatus.NOT_FOUND, 'Role not found');
    }

    // Prevent deactivating super-admin
    if (role.slug === 'super-admin' && body.isActive === false) {
      return error(HttpStatus.BAD_REQUEST, 'Cannot deactivate the super-admin role');
    }

    // Slug uniqueness if changing slug
    if (body.slug && body.slug !== role.slug) {
      const [slugExists] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.slug, body.slug), ne(roles.id, roleId)))
        .limit(1);
      if (slugExists) {
        return error(HttpStatus.BAD_REQUEST, `Role with slug "${body.slug}" already exists`);
      }
    }

    const updates: Partial<typeof roles.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(roles)
      .set(updates)
      .where(eq(roles.id, roleId))
      .returning({ id: roles.id, name: roles.name, slug: roles.slug, isActive: roles.isActive });

    return success('Role updated successfully', updated);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function deleteRole(request: FastifyRequest) {
  try {
    const { roleId } = request.params as any;

    const [role] = await db
      .select({ id: roles.id, slug: roles.slug })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);

    if (!role) {
      return error(HttpStatus.NOT_FOUND, 'Role not found');
    }

    if (role.slug === 'super-admin') {
      return error(HttpStatus.BAD_REQUEST, 'Cannot delete the super-admin role');
    }

    // Prevent deletion if users are assigned
    const [{ total }] = await db
      .select({ total: count() })
      .from(users)
      .where(eq(users.roleId, roleId));

    if (Number(total) > 0) {
      return error(HttpStatus.BAD_REQUEST, `Cannot delete role: ${total} user(s) are assigned to it`);
    }

    await db.delete(roles).where(eq(roles.id, roleId));

    return success('Role deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function listUsers(request: FastifyRequest) {
  try {
    const q = (request.query ?? {}) as {
      roleSlug?: string;
      search?: string;
      page?: string | number;
      limit?: string | number;
    };
    const paginated = q.page != null || q.limit != null;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const offset = (page - 1) * limit;
    const search = (q.search ?? '').trim().toLowerCase();

    const conds: any[] = [eq(users.isDeleted, false)];
    if (q.roleSlug && q.roleSlug !== 'all') {
      conds.push(eq(roles.slug, q.roleSlug));
    }
    if (search) {
      // Match against username, email, or role name (case-insensitive).
      const like = `%${search}%`;
      conds.push(
        sql`(LOWER(${users.username}) LIKE ${like} OR LOWER(${users.email}) LIKE ${like} OR LOWER(${roles.name}) LIKE ${like})`,
      );
    }
    const where = conds.length === 1 ? conds[0] : and(...conds);

    const [{ total }] = await db
      .select({ total: count() })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(where);

    const baseQuery = db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        isActive: users.isActive,
        shopScope: users.shopScope,
        warrantyOnly: users.warrantyOnly,
        createdAt: users.createdAt,
        evolveTechnicianNo: users.evolveTechnicianNo,
        evolveSaNumber: users.evolveSaNumber,
        ability: users.ability,
        designationId: users.designationId,
        designationName: designations.name,
        designationActive: designations.isActive,
        roleName: roles.name,
        roleSlug: roles.slug,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .leftJoin(designations, eq(designations.id, users.designationId))
      .where(where)
      .orderBy(users.createdAt);

    const rows = paginated
      ? await baseQuery.limit(limit).offset(offset)
      : await baseQuery;

    const data = await Promise.all(rows.map(async (r: any) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      fullName: r.fullName ?? null,
      avatarUrl: r.avatarUrl ? await signUrl(r.avatarUrl) : null,
      isActive: r.isActive,
      shopScope: r.shopScope,
      warrantyOnly: r.warrantyOnly,
      createdAt: r.createdAt,
      evolveTechnicianNo: r.evolveTechnicianNo,
      evolveSaNumber: r.evolveSaNumber,
      ability: r.ability,
      designationId: r.designationId,
      designationName: r.designationName ?? null,
      designationActive: r.designationActive ?? null,
      role: { name: r.roleName, slug: r.roleSlug },
    })));

    if (!paginated) {
      return success('Users fetched successfully', data);
    }

    // Filter-independent stats for the dashboard cards.
    const [{ totalAll }] = await db
      .select({ totalAll: count() })
      .from(users)
      .where(eq(users.isDeleted, false));
    const [{ totalActive }] = await db
      .select({ totalActive: count() })
      .from(users)
      .where(and(eq(users.isDeleted, false), eq(users.isActive, true)));

    const totalNum = Number(total) || 0;
    return success('Users fetched successfully', {
      data,
      pagination: {
        page,
        limit,
        total: totalNum,
        totalPages: Math.max(1, Math.ceil(totalNum / limit)),
      },
      stats: {
        totalUsers: Number(totalAll) || 0,
        totalActive: Number(totalActive) || 0,
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Returns the username currently mapped to this Evolve TechnicianNo (excluding
// `excludeUserId`), or null if free. Enforces one-user-per-TechnicianNo. No live
// Evolve call — the picker already restricts choices to active technicians.
async function evolveTechNoOwner(evolveTechnicianNo: number, excludeUserId?: string): Promise<string | null> {
  const conds: any[] = [eq(users.evolveTechnicianNo, evolveTechnicianNo), eq(users.isDeleted, false)];
  if (excludeUserId) conds.push(ne(users.id, excludeUserId));
  const [owner] = await db
    .select({ username: users.username })
    .from(users)
    .where(and(...conds))
    .limit(1);
  return owner?.username ?? null;
}

// Verify a selected Evolve TechnicianNo is still an ACTIVE Evolve technician.
// Shared by createUser / updateUser / setUserEvolveTechnicianNo so the rule lives
// in exactly one place (reuses fetchActiveTechnicians). NULL/undefined means no
// mapping was requested → allowed. Returns an {status,message} descriptor to
// surface via error(...), or null when the number is valid (or not supplied).
async function validateEvolveTechnicianActive(
  evolveTechnicianNo: number | null | undefined,
): Promise<{ status: number; message: string } | null> {
  if (evolveTechnicianNo == null) return null;
  try {
    const activeTechnicians = await fetchActiveTechnicians();
    const match = activeTechnicians.find((t) => t.technicianNo === evolveTechnicianNo);
    if (!match) {
      return { status: HttpStatus.BAD_REQUEST, message: 'Selected Evolve Technician is no longer active.' };
    }
    return null;
  } catch {
    // Evolve unreachable / non-success → retryable upstream issue (mirrors the
    // behaviour previously inlined in setUserEvolveTechnicianNo).
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Could not validate the technician against Evolve. Please try again.',
    };
  }
}

// Returns the username currently mapped to this Evolve SANumber (excluding
// `excludeUserId`), or null if free. Enforces one-user-per-SANumber (also
// guarded by the partial-unique index). Mirrors evolveTechNoOwner.
async function evolveSaNoOwner(evolveSaNumber: number, excludeUserId?: string): Promise<string | null> {
  const conds: any[] = [eq(users.evolveSaNumber, evolveSaNumber), eq(users.isDeleted, false)];
  if (excludeUserId) conds.push(ne(users.id, excludeUserId));
  const [owner] = await db
    .select({ username: users.username })
    .from(users)
    .where(and(...conds))
    .limit(1);
  return owner?.username ?? null;
}

// Verify a selected Evolve SANumber is still an ACTIVE Evolve service advisor.
// Shared by createUser / updateUser / setUserEvolveSaNumber. NULL/undefined →
// no mapping requested → allowed. Mirrors validateEvolveTechnicianActive.
async function validateEvolveServiceAdvisorActive(
  evolveSaNumber: number | null | undefined,
): Promise<{ status: number; message: string } | null> {
  if (evolveSaNumber == null) return null;
  try {
    const activeAdvisors = await fetchActiveServiceAdvisors();
    const match = activeAdvisors.find((s) => s.saNumber === evolveSaNumber);
    if (!match) {
      return { status: HttpStatus.BAD_REQUEST, message: 'Selected Evolve Service Advisor is no longer active.' };
    }
    return null;
  } catch {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Could not validate the service advisor against Evolve. Please try again.',
    };
  }
}

// Validate + normalise the optional Ability (0–1 to 2dp). Returns the key only
// if present in the body (undefined = leave untouched); `error` on invalid input.
function normalizeAbility(body: any): { ability?: string | null; error?: string } {
  if (body.ability === undefined) return {};
  if (body.ability === null || body.ability === '') return { ability: null };
  const a = Number(body.ability);
  if (!Number.isFinite(a) || a < 0 || a > 1) return { error: 'Ability must be a number between 0 and 1' };
  return { ability: a.toFixed(2) };
}

// Resolve + validate designationId against the master. Accepts any EXISTING
// designation (active or inactive) so an existing technician keeps its (possibly
// deactivated) designation on edit. undefined = leave untouched; null = clear.
async function resolveDesignationId(body: any): Promise<{ designationId?: string | null; error?: string }> {
  if (body.designationId === undefined) return {};
  if (body.designationId === null || body.designationId === '') return { designationId: null };
  const [d] = await db
    .select({ id: designations.id })
    .from(designations)
    .where(eq(designations.id, body.designationId))
    .limit(1);
  if (!d) return { error: 'Invalid designation' };
  return { designationId: body.designationId };
}

export async function createUser(request: FastifyRequest) {
  try {
    // Validate the request body before any business logic runs (Issue 2).
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(HttpStatus.BAD_REQUEST, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const body = parsed.data as any;

    // Check email uniqueness (ignore soft-deleted users)
    const [existingEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, body.email), eq(users.isDeleted, false)))
      .limit(1);
    if (existingEmail) {
      return error(HttpStatus.BAD_REQUEST, 'A user with this email already exists');
    }

    // Check username uniqueness (ignore soft-deleted users)
    const [existingUsername] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, body.username), eq(users.isDeleted, false)))
      .limit(1);
    if (existingUsername) {
      return error(HttpStatus.BAD_REQUEST, 'A user with this username already exists');
    }

    // Resolve role
    const [role] = await db
      .select({ id: roles.id, name: roles.name, slug: roles.slug })
      .from(roles)
      .where(eq(roles.slug, body.roleSlug))
      .limit(1);
    if (!role) {
      return error(HttpStatus.NOT_FOUND, `Role "${body.roleSlug}" not found`);
    }

    // Technician-only fields — persisted only when the role is technician.
    let evolveTechnicianNo: number | null = null;
    let ability: string | null = null;
    let designationId: string | null = null;
    if (role.slug === 'technician') {
      if (body.evolveTechnicianNo != null) {
        // Must still be an ACTIVE Evolve technician (Issue 1).
        const activeErr = await validateEvolveTechnicianActive(body.evolveTechnicianNo);
        if (activeErr) return error(activeErr.status, activeErr.message);
        const owner = await evolveTechNoOwner(body.evolveTechnicianNo);
        if (owner) {
          return error(HttpStatus.BAD_REQUEST, `Evolve TechnicianNo ${body.evolveTechnicianNo} is already mapped to "${owner}"`);
        }
        evolveTechnicianNo = body.evolveTechnicianNo;
      }
      const ab = normalizeAbility(body);
      if (ab.error) return error(HttpStatus.BAD_REQUEST, ab.error);
      ability = ab.ability ?? null;
      const des = await resolveDesignationId(body);
      if (des.error) return error(HttpStatus.BAD_REQUEST, des.error);
      designationId = des.designationId ?? null;
    }

    // Service-advisor-only field — persisted only when the role is service-advisor.
    let evolveSaNumber: number | null = null;
    if (role.slug === 'service-advisor' && body.evolveSaNumber != null) {
      const activeErr = await validateEvolveServiceAdvisorActive(body.evolveSaNumber);
      if (activeErr) return error(activeErr.status, activeErr.message);
      const owner = await evolveSaNoOwner(body.evolveSaNumber);
      if (owner) {
        return error(HttpStatus.BAD_REQUEST, `Evolve SANumber ${body.evolveSaNumber} is already mapped to "${owner}"`);
      }
      evolveSaNumber = body.evolveSaNumber;
    }

    const hashedPassword = await bcrypt.hash(body.password, 12);

    const [newUser] = await db
      .insert(users)
      .values({
        username: body.username,
        email: body.email,
        password: hashedPassword,
        fullName: body.fullName ?? null,
        avatarUrl: body.avatarUrl ?? null,
        roleId: role.id,
        shopScope: body.shopScope ?? 'ALL',
        warrantyOnly: body.warrantyOnly ?? false,
        evolveTechnicianNo,
        evolveSaNumber,
        ability,
        designationId,
      })
      .returning({ id: users.id, username: users.username, email: users.email, isActive: users.isActive, shopScope: users.shopScope, warrantyOnly: users.warrantyOnly, createdAt: users.createdAt });

    sendWelcomeEmail({
      username: body.username,
      email:    body.email,
      password: body.password,
      roleSlug: role.slug,
      roleName: role.name,
      loginUrl: env.FRONTEND_URL,
    });

    return created('User created successfully', { ...newUser, role: { name: role.name, slug: role.slug } });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function updateUser(request: FastifyRequest) {
  try {
    const { userId } = request.params as any;
    // Validate the request body before any business logic runs (Issue 2).
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(HttpStatus.BAD_REQUEST, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const body = parsed.data as any;
    const requestingUserId = (request as any).user?.userId;

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        roleId: users.roleId,
        roleSlug: roles.slug,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return error(HttpStatus.NOT_FOUND, 'User not found');
    }

    // Protect super-admin users (allow self-edit only)
    if (user.roleSlug === 'super-admin' && userId !== requestingUserId) {
      return error(HttpStatus.BAD_REQUEST, 'Cannot modify a super-admin user');
    }

    // Prevent self-deactivation
    if (userId === requestingUserId && body.isActive === false) {
      return error(HttpStatus.BAD_REQUEST, 'You cannot deactivate your own account');
    }

    // Email uniqueness check (ignore soft-deleted users)
    if (body.email && body.email !== user.email) {
      const [emailExists] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.email, body.email),
            ne(users.id, userId),
            eq(users.isDeleted, false),
          ),
        )
        .limit(1);
      if (emailExists) {
        return error(HttpStatus.BAD_REQUEST, 'A user with this email already exists');
      }
    }

    // Username uniqueness check (ignore soft-deleted users)
    if (body.username && body.username !== user.username) {
      const [usernameExists] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.username, body.username),
            ne(users.id, userId),
            eq(users.isDeleted, false),
          ),
        )
        .limit(1);
      if (usernameExists) {
        return error(HttpStatus.BAD_REQUEST, 'A user with this username already exists');
      }
    }

    const updates: Partial<typeof users.$inferInsert> = {};
    if (body.username !== undefined) updates.username = body.username;
    if (body.email !== undefined) updates.email = body.email;
    if (body.fullName !== undefined) updates.fullName = body.fullName ?? null;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.password) updates.password = await bcrypt.hash(body.password, 12);
    // Avatar: set the new path; delete the previous image (best-effort).
    if (body.avatarUrl !== undefined) {
      const [prev] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId)).limit(1);
      updates.avatarUrl = body.avatarUrl ?? null;
      if (prev?.avatarUrl && prev.avatarUrl !== body.avatarUrl) {
        try { await deleteFile(prev.avatarUrl); } catch { /* best-effort */ }
      }
    }
    if (body.shopScope !== undefined) updates.shopScope = body.shopScope;
    if (body.warrantyOnly !== undefined) updates.warrantyOnly = body.warrantyOnly;

    if (body.roleSlug) {
      const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.slug, body.roleSlug))
        .limit(1);
      if (!role) {
        return error(HttpStatus.NOT_FOUND, `Role "${body.roleSlug}" not found`);
      }
      updates.roleId = role.id;
    }

    // Evolve technician mapping: persist only for technician users. If the role
    // is (or changes to) non-technician, clear the mapping so it never lingers.
    const finalSlug = body.roleSlug ?? user.roleSlug;
    if (finalSlug === 'technician') {
      if (body.evolveTechnicianNo !== undefined) {
        if (body.evolveTechnicianNo === null) {
          updates.evolveTechnicianNo = null;
        } else {
          // Must still be an ACTIVE Evolve technician (Issue 1).
          const activeErr = await validateEvolveTechnicianActive(body.evolveTechnicianNo);
          if (activeErr) return error(activeErr.status, activeErr.message);
          const owner = await evolveTechNoOwner(body.evolveTechnicianNo, userId);
          if (owner) {
            return error(HttpStatus.BAD_REQUEST, `Evolve TechnicianNo ${body.evolveTechnicianNo} is already mapped to "${owner}"`);
          }
          updates.evolveTechnicianNo = body.evolveTechnicianNo;
        }
      }
      const ab = normalizeAbility(body);
      if (ab.error) return error(HttpStatus.BAD_REQUEST, ab.error);
      if (ab.ability !== undefined) updates.ability = ab.ability;
      const des = await resolveDesignationId(body);
      if (des.error) return error(HttpStatus.BAD_REQUEST, des.error);
      if (des.designationId !== undefined) updates.designationId = des.designationId;
    } else {
      // Role is (or changed to) non-technician → drop all technician-only data.
      updates.evolveTechnicianNo = null;
      updates.ability = null;
      updates.designationId = null;
    }

    // Evolve service-advisor mapping: persist only for service-advisor users.
    // If the role is (or changes to) non-SA, clear it so it never lingers.
    if (finalSlug === 'service-advisor') {
      if (body.evolveSaNumber !== undefined) {
        if (body.evolveSaNumber === null) {
          updates.evolveSaNumber = null;
        } else {
          const activeErr = await validateEvolveServiceAdvisorActive(body.evolveSaNumber);
          if (activeErr) return error(activeErr.status, activeErr.message);
          const owner = await evolveSaNoOwner(body.evolveSaNumber, userId);
          if (owner) {
            return error(HttpStatus.BAD_REQUEST, `Evolve SANumber ${body.evolveSaNumber} is already mapped to "${owner}"`);
          }
          updates.evolveSaNumber = body.evolveSaNumber;
        }
      }
    } else {
      updates.evolveSaNumber = null;
    }

    updates.updatedAt = new Date();

    await db.update(users).set(updates).where(eq(users.id, userId));

    // Fetch updated user with role
    const [updatedUser] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        isActive: users.isActive,
        shopScope: users.shopScope,
        warrantyOnly: users.warrantyOnly,
        roleName: roles.name,
        roleSlug: roles.slug,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, userId))
      .limit(1);

    // Invalidate the per-user scope cache so a shopScope/warrantyOnly change
    // takes effect immediately (mirrors invalidatePermissionsCache for roles).
    invalidateScopeCache(userId);

    return success('User updated successfully', {
      id: updatedUser.id,
      username: updatedUser.username,
      email: updatedUser.email,
      isActive: updatedUser.isActive,
      shopScope: updatedUser.shopScope,
      warrantyOnly: updatedUser.warrantyOnly,
      role: { name: updatedUser.roleName, slug: updatedUser.roleSlug },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function deleteUser(request: FastifyRequest) {
  try {
    const { userId } = request.params as any;
    const requestingUserId = (request as any).user?.userId;

    if (userId === requestingUserId) {
      return error(HttpStatus.BAD_REQUEST, 'You cannot delete your own account');
    }

    const [user] = await db
      .select({
        id: users.id,
        isDeleted: users.isDeleted,
        email: users.email,
        username: users.username,
        roleSlug: roles.slug,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || user.isDeleted) {
      return error(HttpStatus.NOT_FOUND, 'User not found');
    }

    if (user.roleSlug === 'super-admin') {
      return error(HttpStatus.BAD_REQUEST, 'Cannot delete a super-admin user');
    }

    // Tombstone email/username so the original values can be reused by new users
    // (DB has unique indexes on both columns that apply to soft-deleted rows too).
    const tombstoneSuffix = `__deleted_${Date.now()}`;
    const [current] = await db
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    await db
      .update(users)
      .set({
        email: `${current?.email ?? ''}${tombstoneSuffix}`,
        username: `${current?.username ?? ''}${tombstoneSuffix}`,
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: requestingUserId ?? null,
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return success('User deleted successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Role Permissions ─────────────────────────────────────────────────────────

export async function getRolePermissions(request: FastifyRequest) {
  try {
    const { roleId } = request.params as any;

    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);

    if (!role) {
      return error(HttpStatus.NOT_FOUND, 'Role not found');
    }

    const rows = await db
      .select({ resource: permissions.resource, action: permissions.action })
      .from(permissions)
      .where(eq(permissions.roleId, roleId));

    return success('Permissions fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

export async function updateRolePermissions(request: FastifyRequest) {
  try {
    const { roleId } = request.params as any;

    const [role] = await db
      .select({ id: roles.id, slug: roles.slug })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);

    if (!role) {
      return error(HttpStatus.NOT_FOUND, 'Role not found');
    }

    if (role.slug === 'super-admin') {
      return error(HttpStatus.BAD_REQUEST, 'Cannot modify permissions for the super-admin role');
    }

    const body = request.body as { permissions: { resource: string; action: string }[] };
    if (!Array.isArray(body?.permissions)) {
      return error(HttpStatus.BAD_REQUEST, 'permissions must be an array of { resource, action } objects');
    }

    // Replace all permissions for the role in a transaction
    await db.transaction(async (tx: any) => {
      await tx.delete(permissions).where(eq(permissions.roleId, roleId));

      if (body.permissions.length > 0) {
        await tx.insert(permissions).values(
          body.permissions.map((p: any) => ({
            roleId,
            resource: p.resource,
            action: p.action,
          })),
        );
      }
    });

    // Invalidate cache so changes take effect immediately
    invalidatePermissionsCache(roleId);

    return success('Permissions updated successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Evolve Technician Mapping (admin) ─────────────────────────────────────────
// Maps local technician users to their Evolve TechnicianNo (users.evolve_technician_no).
// Admin-only; the Service Advisor never sees these endpoints. The stored number
// is later resolved at RO-sync time to populate <TechNo> in ROJobDetails.

/**
 * Return the ACTIVE Evolve technicians (live from IRM_GetLookupDropdownTables)
 * so the admin can pick one to map a local technician to. Read-only.
 */
export async function listEvolveTechnicians(_request: FastifyRequest) {
  try {
    const technicians = await fetchActiveTechnicians();
    return success('Evolve technicians fetched successfully', technicians);
  } catch (err) {
    console.log('error :- ', err);
    // Evolve unreachable / non-success → surface a clear, retryable message
    // so the admin knows it is an upstream issue.
    return error(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not fetch technicians from Evolve. Please try again.');
  }
}

/**
 * List local technician users (role=technician) with their current Evolve
 * mapping, so the admin UI can show mapped/unmapped state at a glance.
 */
export async function listTechnicianMappings(_request: FastifyRequest) {
  try {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        isActive: users.isActive,
        evolveTechnicianNo: users.evolveTechnicianNo,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.isDeleted, false), eq(roles.slug, 'technician')))
      .orderBy(users.username);

    return success('Technician mappings fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

/**
 * Set (or clear) a technician user's Evolve TechnicianNo. Validates that the
 * target user is a technician, that a non-null number is currently ACTIVE in
 * Evolve, and that no other user already owns that number.
 */
export async function setUserEvolveTechnicianNo(request: FastifyRequest) {
  try {
    const { userId } = request.params as { userId: string };
    const parsed = setEvolveTechnicianNoSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(HttpStatus.BAD_REQUEST, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const { evolveTechnicianNo } = parsed.data;

    const [user] = await db
      .select({ id: users.id, roleSlug: roles.slug })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);

    if (!user) {
      return error(HttpStatus.NOT_FOUND, 'User not found');
    }
    if (user.roleSlug !== 'technician') {
      return error(HttpStatus.BAD_REQUEST, 'Only technician users can be mapped to an Evolve TechnicianNo');
    }

    if (evolveTechnicianNo !== null) {
      // Validate the number is a currently-active Evolve technician (shared helper).
      const activeErr = await validateEvolveTechnicianActive(evolveTechnicianNo);
      if (activeErr) return error(activeErr.status, activeErr.message);

      // Enforce one-user-per-TechnicianNo (also guarded by the partial-unique index).
      const [owner] = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(
          and(
            eq(users.evolveTechnicianNo, evolveTechnicianNo),
            ne(users.id, userId),
            eq(users.isDeleted, false),
          ),
        )
        .limit(1);
      if (owner) {
        return error(HttpStatus.BAD_REQUEST, `TechnicianNo ${evolveTechnicianNo} is already mapped to "${owner.username}"`);
      }
    }

    await db
      .update(users)
      .set({ evolveTechnicianNo, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return success('Technician mapping updated successfully', { userId, evolveTechnicianNo });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Service Advisor mapping (mirrors technician mapping) ──────────────────────

// Live list of ACTIVE Evolve service advisors for the admin picker.
export async function listEvolveServiceAdvisors(_request: FastifyRequest) {
  try {
    const advisors = await fetchActiveServiceAdvisors();
    return success('Evolve service advisors fetched successfully', advisors);
  } catch (err) {
    console.log('error :- ', err);
    return error(HttpStatus.INTERNAL_SERVER_ERROR, 'Could not fetch service advisors from Evolve. Please try again.');
  }
}

// Local service-advisor users with their current Evolve mapping.
export async function listServiceAdvisorMappings(_request: FastifyRequest) {
  try {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        isActive: users.isActive,
        evolveSaNumber: users.evolveSaNumber,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.isDeleted, false), eq(roles.slug, 'service-advisor')))
      .orderBy(users.username);

    return success('Service advisor mappings fetched successfully', rows);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// Set (or clear) a service-advisor user's Evolve SANumber.
export async function setUserEvolveSaNumber(request: FastifyRequest) {
  try {
    const { userId } = request.params as { userId: string };
    const parsed = setEvolveSaNumberSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(HttpStatus.BAD_REQUEST, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const { evolveSaNumber } = parsed.data;

    const [user] = await db
      .select({ id: users.id, roleSlug: roles.slug })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);

    if (!user) {
      return error(HttpStatus.NOT_FOUND, 'User not found');
    }
    if (user.roleSlug !== 'service-advisor') {
      return error(HttpStatus.BAD_REQUEST, 'Only service-advisor users can be mapped to an Evolve SANumber');
    }

    if (evolveSaNumber !== null) {
      const activeErr = await validateEvolveServiceAdvisorActive(evolveSaNumber);
      if (activeErr) return error(activeErr.status, activeErr.message);
      const owner = await evolveSaNoOwner(evolveSaNumber, userId);
      if (owner) {
        return error(HttpStatus.BAD_REQUEST, `SANumber ${evolveSaNumber} is already mapped to "${owner}"`);
      }
    }

    await db
      .update(users)
      .set({ evolveSaNumber, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return success('Service advisor mapping updated successfully', { userId, evolveSaNumber });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
