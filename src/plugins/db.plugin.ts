import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { checkDatabaseConnection } from '../db';

export const dbPlugin = fp(async (app: FastifyInstance) => {
  await checkDatabaseConnection();
  app.log.info('Database connected');
});
