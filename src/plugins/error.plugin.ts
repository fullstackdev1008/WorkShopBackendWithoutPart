import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { errorHandler } from '../shared/errors/appError';

export const errorPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler(errorHandler);
});
