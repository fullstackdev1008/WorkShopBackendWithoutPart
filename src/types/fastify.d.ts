import { JwtPayload } from '../shared/security/auth.middleware';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}
