import { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { eq, and, gt, ne, sql } from 'drizzle-orm';
import { db } from '../../db';
import { users, roles, permissions, userSessions } from '../../db/models';
import { success, error, created, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';
import { env } from '../../config/env';
import { updateProfileSchema } from './dto';
import { handleSingleFileUpload, deleteFile } from '../../shared/upload/upload';
import { signUrl } from '../../middleware/s3';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDurationMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (multipliers[unit] ?? 86_400_000);
}

// ─── Login ──────────────────────────────────────────────────────────────────
export async function login(request: FastifyRequest) {
  try {
    const body = request.body as any;

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        password: users.password,
        isActive: users.isActive,
        isDeleted: users.isDeleted,
        shopScope: users.shopScope,
        warrantyOnly: users.warrantyOnly,
        roleId: users.roleId,
        roleName: roles.name,
        roleSlug: roles.slug,
        roleIsActive: roles.isActive,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.email, body.email), eq(users.isDeleted, false)))
      .limit(1);

    if (!user) {
      return error(HttpStatus.UNAUTHORIZED, 'Invalid email or password');
    }

    if (!user.isActive) {
      return error(HttpStatus.UNAUTHORIZED, 'Account is deactivated. Contact administrator.');
    }

    if (!user.roleIsActive) {
      return error(HttpStatus.UNAUTHORIZED, 'Your role has been deactivated. Contact administrator.');
    }

    const isPasswordValid = await bcrypt.compare(body.password, user.password);
    if (!isPasswordValid) {
      return error(HttpStatus.UNAUTHORIZED, 'Invalid email or password');
    }

    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + parseDurationMs(env.JWT_EXPIRES_IN));

    const token = jwt.sign(
      {
        jti,
        userId: user.id,
        email: user.email,
        roleSlug: user.roleSlug,
        roleName: user.roleName,
        roleId: user.roleId,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any },
    );

    // Create session record
    await db.insert(userSessions).values({
      userId: user.id,
      jti,
      ipAddress: request.ip ?? null,
      userAgent: (request.headers['user-agent'] ?? '').slice(0, 500) || null,
      expiresAt,
    });

    const permRows = await db
      .select({ resource: permissions.resource, action: permissions.action })
      .from(permissions)
      .where(eq(permissions.roleId, user.roleId));
    const userPermissions = permRows.map((p: any) => `${p.resource}:${p.action}`);

    return success('Login successful', {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl ? await signUrl(user.avatarUrl) : null,
        role: { name: user.roleName, slug: user.roleSlug },
        shopScope: user.shopScope,
        warrantyOnly: user.warrantyOnly,
        permissions: userPermissions,
      },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Logout ──────────────────────────────────────────────────────────────────
export async function logout(request: FastifyRequest) {
  try {
    const jti = request.user!.jti;
    if (!jti) return success('Logged out successfully', null);

    await db
      .update(userSessions)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(userSessions.jti, jti));

    return success('Logged out successfully', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── List Sessions ────────────────────────────────────────────────────────────
export async function listSessions(request: FastifyRequest) {
  try {
    const userId = request.user!.userId;
    const currentJti = request.user!.jti;
    const now = new Date();

    const sessions = await db
      .select({
        id: userSessions.id,
        jti: userSessions.jti,
        ipAddress: userSessions.ipAddress,
        userAgent: userSessions.userAgent,
        isRevoked: userSessions.isRevoked,
        revokedAt: userSessions.revokedAt,
        expiresAt: userSessions.expiresAt,
        createdAt: userSessions.createdAt,
      })
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), gt(userSessions.expiresAt, now)))
      .orderBy(userSessions.createdAt);

    const data = sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      isRevoked: s.isRevoked,
      isCurrent: s.jti === currentJti,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
    }));

    return success('Sessions fetched', data);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Revoke Session ───────────────────────────────────────────────────────────
export async function revokeSession(request: FastifyRequest) {
  try {
    const userId = request.user!.userId;
    const { sessionId } = request.params as { sessionId: string };

    const [session] = await db
      .select({ id: userSessions.id, userId: userSessions.userId })
      .from(userSessions)
      .where(eq(userSessions.id, sessionId))
      .limit(1);

    if (!session) return error(HttpStatus.NOT_FOUND, 'Session not found');
    if (session.userId !== userId) return error(HttpStatus.FORBIDDEN, 'Access denied');

    await db
      .update(userSessions)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(userSessions.id, sessionId));

    return success('Session revoked', null);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Register ───────────────────────────────────────────────────────────────
export async function register(request: FastifyRequest) {
  try {
    const body = request.body as any;

    const [role] = await db
      .select({ id: roles.id, name: roles.name, slug: roles.slug })
      .from(roles)
      .where(eq(roles.slug, body.roleSlug))
      .limit(1);

    if (!role) {
      return error(HttpStatus.NOT_FOUND, `Role "${body.roleSlug}" not found`);
    }

    const hashedPassword = await bcrypt.hash(body.password, 12);

    const [newUser] = await db
      .insert(users)
      .values({ username: body.username, email: body.email, password: hashedPassword, roleId: role.id })
      .returning({ id: users.id, username: users.username, email: users.email, createdAt: users.createdAt });

    return created('User registered successfully', {
      user: { ...newUser, role: { name: role.name, slug: role.slug } },
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Get Profile ────────────────────────────────────────────────────────────
export async function getProfile(request: FastifyRequest) {
  try {
    const userId = request.user!.userId;

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        isActive: users.isActive,
        shopScope: users.shopScope,
        warrantyOnly: users.warrantyOnly,
        roleName: roles.name,
        roleSlug: roles.slug,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);

    if (!user) {
      return error(HttpStatus.NOT_FOUND, 'User not found');
    }

    return success('Profile fetched successfully', {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl ? await signUrl(user.avatarUrl) : null,
      isActive: user.isActive,
      shopScope: user.shopScope,
      warrantyOnly: user.warrantyOnly,
      role: { name: user.roleName, slug: user.roleSlug },
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Update Profile (self only — always uses the JWT userId) ─────────────────
export async function updateProfile(request: FastifyRequest) {
  try {
    const userId = request.user!.userId;
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(HttpStatus.BAD_REQUEST, parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const { fullName, username, email, password } = parsed.data;

    const [current] = await db
      .select({ id: users.id, username: users.username, email: users.email, fullName: users.fullName })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);
    if (!current) return error(HttpStatus.NOT_FOUND, 'User not found');

    // Case-insensitive uniqueness (service-level; excludes self). No DB unique index.
    const [dupeUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.username}) = lower(${username})`, ne(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);
    if (dupeUser) return error(HttpStatus.BAD_REQUEST, 'Username is already taken');

    const [dupeEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${email})`, ne(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);
    if (dupeEmail) return error(HttpStatus.BAD_REQUEST, 'Email is already in use');

    const updates: Partial<typeof users.$inferInsert> = {
      fullName: fullName ?? null,
      username,
      email,
      updatedAt: new Date(),
    };
    if (password) updates.password = await bcrypt.hash(password, 12);

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
      });

    // Audit via structured logging — changed fields only, never the password value.
    const changed: string[] = [];
    if ((current.fullName ?? '') !== (fullName ?? '')) changed.push('fullName');
    if (current.username !== username) changed.push('username');
    if (current.email.toLowerCase() !== email.toLowerCase()) changed.push('email');
    if (password) changed.push('password');
    console.log(`[profile.update] user=${userId} changed=[${changed.join(', ')}]`);

    return success('Profile updated successfully', {
      ...updated,
      avatarUrl: updated.avatarUrl ? await signUrl(updated.avatarUrl) : null,
    });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Upload Profile Photo (self only) ────────────────────────────────────────
export async function uploadProfilePhoto(request: FastifyRequest) {
  try {
    const userId = request.user!.userId;

    const [current] = await db
      .select({ id: users.id, avatarUrl: users.avatarUrl })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);
    if (!current) return error(HttpStatus.NOT_FOUND, 'User not found');

    // Reuse the shared upload util (validates jpg/jpeg/png/webp + MIME, compresses).
    let uploaded;
    try {
      uploaded = (await handleSingleFileUpload(request)).file;
    } catch (e) {
      return error(HttpStatus.BAD_REQUEST, (e as Error)?.message ?? 'Invalid image upload');
    }

    await db.update(users).set({ avatarUrl: uploaded.path, updatedAt: new Date() }).where(eq(users.id, userId));

    // Delete the previous image (best-effort) after the new one is stored.
    if (current.avatarUrl && current.avatarUrl !== uploaded.path) {
      try { await deleteFile(current.avatarUrl); } catch { /* best-effort */ }
    }

    console.log(`[profile.update] user=${userId} changed=[avatar]`);
    return success('Profile photo updated', { avatarUrl: await signUrl(uploaded.path) });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// ─── Remove Profile Photo (self only) ────────────────────────────────────────
export async function removeProfilePhoto(request: FastifyRequest) {
  try {
    const userId = request.user!.userId;
    const [current] = await db
      .select({ id: users.id, avatarUrl: users.avatarUrl })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isDeleted, false)))
      .limit(1);
    if (!current) return error(HttpStatus.NOT_FOUND, 'User not found');

    if (current.avatarUrl) {
      await db.update(users).set({ avatarUrl: null, updatedAt: new Date() }).where(eq(users.id, userId));
      try { await deleteFile(current.avatarUrl); } catch { /* best-effort */ }
      console.log(`[profile.update] user=${userId} changed=[avatar-removed]`);
    }
    return success('Profile photo removed', { avatarUrl: null });
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
