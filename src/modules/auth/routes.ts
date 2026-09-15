import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { loginSchema, registerSchema } from './dto';
import { login, logout, register, getProfile, updateProfile, uploadProfilePhoto, removeProfilePhoto, listSessions, revokeSession } from './service';
import { authenticate } from '../../shared/security/auth.middleware';
import { validate } from '../../shared/http/validate';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const loginHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await login(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const logoutHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await logout(req);
    const code = (result as any)?.success?.code || (result as any)?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const registerHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await register(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getProfileHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getProfile(req);
    const code = result?.success?.code || result?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateProfileHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateProfile(req);
    const code = (result as any)?.success?.code || (result as any)?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const uploadProfilePhotoHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await uploadProfilePhoto(req);
    const code = (result as any)?.success?.code || (result as any)?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const removeProfilePhotoHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await removeProfilePhoto(req);
    const code = (result as any)?.success?.code || (result as any)?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listSessionsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listSessions(req);
    const code = (result as any)?.success?.code || (result as any)?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const revokeSessionHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await revokeSession(req);
    const code = (result as any)?.success?.code || (result as any)?.error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login',   { preHandler: [validate(loginSchema)] },    loginHandler);
  app.post('/logout',  { preHandler: [authenticate] },              logoutHandler);
  app.post('/register',{ preHandler: [validate(registerSchema)] }, registerHandler);
  app.get('/profile',  { preHandler: [authenticate] },              getProfileHandler);
  app.put('/profile',  { preHandler: [authenticate] },              updateProfileHandler);
  app.post('/profile/photo',   { preHandler: [authenticate] },      uploadProfilePhotoHandler);
  app.delete('/profile/photo', { preHandler: [authenticate] },      removeProfilePhotoHandler);
  app.get('/sessions', { preHandler: [authenticate] },              listSessionsHandler);
  app.delete('/sessions/:sessionId', { preHandler: [authenticate] }, revokeSessionHandler);
};
