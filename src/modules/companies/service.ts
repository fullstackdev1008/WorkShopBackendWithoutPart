import { FastifyRequest } from 'fastify';
import { companyResolver } from '../../services/companyResolver.service';
import { success, serverError } from '../../shared/http/response';

/**
 * GET /api/companies — active companies for the company selector.
 * Projects to PublicCompany (id, code, name) via the resolver, so the Evolve
 * InterfaceCode is never exposed to the client.
 */
export async function listCompanies(_request: FastifyRequest) {
  try {
    const data = await companyResolver.listActive();
    return success('Companies fetched successfully', data);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}
