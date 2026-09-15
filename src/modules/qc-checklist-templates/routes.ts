import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listQcChecklistTemplates,
  addQcChecklistTemplate,
  updateQcChecklistTemplate,
  deleteQcChecklistTemplate,
} from './service';
import { authenticate } from '../../shared/security/auth.middleware';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listQcChecklistTemplatesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listQcChecklistTemplates(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addQcChecklistTemplateHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addQcChecklistTemplate(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateQcChecklistTemplateHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateQcChecklistTemplate(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteQcChecklistTemplateHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteQcChecklistTemplate(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const qcChecklistTemplateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [authenticate] }, listQcChecklistTemplatesHandler);
  app.post('/', { preHandler: [authenticate] }, addQcChecklistTemplateHandler);
  app.put('/:id', { preHandler: [authenticate] }, updateQcChecklistTemplateHandler);
  app.delete('/:id', { preHandler: [authenticate] }, deleteQcChecklistTemplateHandler);
};
