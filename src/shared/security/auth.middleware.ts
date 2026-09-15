import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { env } from '../../config/env';
import { AppError, ForbiddenError } from '../errors/appError';
import { db } from '../../db';
import { permissions, userSessions } from '../../db/models';
import { getCachedPermissions, setCachedPermissions } from './permissionsCache';

export interface JwtPayload {
  jti: string;
  userId: string;
  email: string;
  roleSlug: string;
  roleName: string;
  roleId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

// ─── Authenticate ────────────────────────────────────────────────────────────
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'Authentication required. Please provide a valid token.');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    request.user = decoded;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError(401, 'Token has expired. Please login again.');
    }
    throw new AppError(401, 'Invalid token. Please login again.');
  }

  // Check if the session has been revoked
  if (request.user?.jti) {
    const [session] = await db
      .select({ isRevoked: userSessions.isRevoked })
      .from(userSessions)
      .where(eq(userSessions.jti, request.user.jti))
      .limit(1);

    if (session?.isRevoked) {
      throw new AppError(401, 'Session has been revoked. Please login again.');
    }
  }
}

// ─── Authorize (legacy role-based) ──────────────────────────────────────────
export function authorize(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new AppError(401, 'Authentication required.');
    }

    if (allowedRoles.length === 0) {
      throw new ForbiddenError('Access denied. No roles are permitted for this resource.');
    }

    // Super admin bypasses all role checks
    if (request.user.roleSlug === 'super-admin') return;

    if (!allowedRoles.includes(request.user.roleSlug)) {
      throw new ForbiddenError(
        `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${request.user.roleSlug}`,
      );
    }
  };
}

// ─── Check Any Permission (passes if the user has AT LEAST ONE of the given permissions) ──
export function checkAnyPermission(...checks: [resource: string, action: string][]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) {
      throw new AppError(401, 'Authentication required.');
    }

    if (request.user.roleSlug === 'super-admin') return;

    const roleId = request.user.roleId;

    let perms = getCachedPermissions(roleId);
    if (!perms) {
      const rows = await db
        .select({ resource: permissions.resource, action: permissions.action })
        .from(permissions)
        .where(eq(permissions.roleId, roleId));
      perms = new Set(rows.map((r: any) => `${r.resource}:${r.action}`));
      setCachedPermissions(roleId, perms);
    }

    const hasAny = checks.some(([res, act]) => perms!.has(`${res}:${act}`));
    if (!hasAny) {
      throw new ForbiddenError(
        `Access denied: you do not have permission for this resource`,
      );
    }
  };
}

// ─── Check Permission (resource + action based) ──────────────────────────────
export function checkPermission(resource: string, action: string) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) {
      throw new AppError(401, 'Authentication required.');
    }

    // Super admin bypasses all permission checks
    if (request.user.roleSlug === 'super-admin') return;

    const roleId = request.user.roleId;

    let perms = getCachedPermissions(roleId);
    if (!perms) {
      const rows = await db
        .select({ resource: permissions.resource, action: permissions.action })
        .from(permissions)
        .where(eq(permissions.roleId, roleId));
      perms = new Set(rows.map((r: any) => `${r.resource}:${r.action}`));
      setCachedPermissions(roleId, perms);
    }

    if (!perms.has(`${resource}:${action}`)) {
      throw new ForbiddenError(
        `Access denied: you do not have permission to ${action} ${resource}`,
      );
    }
  };
}
