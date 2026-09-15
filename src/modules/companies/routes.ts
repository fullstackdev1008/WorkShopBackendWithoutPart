import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { listCompanies } from './service';
import { authenticate } from '../../shared/security/auth.middleware';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

const sendResult = (res: FastifyReply, result: unknown) => {
  const code = (result as any)?.success?.code || (result as any)?.error?.code || HttpStatus.OK;
  res.status(code).send(result);
};

const listCompaniesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    sendResult(res, await listCompanies(req));
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

export const companyRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/companies — active companies for the company selector (no interface_code).
  app.get('/', { preHandler: [authenticate] }, listCompaniesHandler);
};
