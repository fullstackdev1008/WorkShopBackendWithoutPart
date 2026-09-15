import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getRolePermissions,
  updateRolePermissions,
  listEvolveTechnicians,
  listTechnicianMappings,
  setUserEvolveTechnicianNo,
  listEvolveServiceAdvisors,
  listServiceAdvisorMappings,
  setUserEvolveSaNumber,
  uploadUserAvatar,
} from './service';
import { authenticate, checkPermission, checkAnyPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listRolesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listRoles(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createRoleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createRole(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateRoleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateRole(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteRoleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteRole(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getRolePermissionsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getRolePermissions(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateRolePermissionsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateRolePermissions(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listUsersHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listUsers(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const createUserHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await createUser(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateUserHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateUser(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const uploadUserAvatarHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await uploadUserAvatar(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteUserHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteUser(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listEvolveTechniciansHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listEvolveTechnicians(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listTechnicianMappingsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listTechnicianMappings(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const setUserEvolveTechnicianNoHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await setUserEvolveTechnicianNo(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listEvolveServiceAdvisorsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listEvolveServiceAdvisors(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const listServiceAdvisorMappingsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listServiceAdvisorMappings(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const setUserEvolveSaNumberHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await setUserEvolveSaNumber(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const userManagementRoutes: FastifyPluginAsync = async (app) => {
  // Roles
  app.get('/roles', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.VIEW)] }, listRolesHandler);
  app.post('/roles', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.CREATE)] }, createRoleHandler);
  app.put('/roles/:roleId', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.EDIT)] }, updateRoleHandler);
  app.delete('/roles/:roleId', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.DELETE)] }, deleteRoleHandler);

  // Role Permissions
  app.get('/roles/:roleId/permissions', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.VIEW)] }, getRolePermissionsHandler);
  app.put('/roles/:roleId/permissions', { preHandler: [authenticate, checkPermission(MODULES.ROLE_MANAGEMENT, ACTIONS.EDIT)] }, updateRolePermissionsHandler);

  // Users
  app.get('/users', { preHandler: [authenticate, checkAnyPermission([MODULES.USER_MANAGEMENT, ACTIONS.VIEW], [MODULES.APPOINTMENT, ACTIONS.VIEW])] }, listUsersHandler);
  app.post('/users', { preHandler: [authenticate, checkPermission(MODULES.USER_MANAGEMENT, ACTIONS.CREATE)] }, createUserHandler);
  app.post('/users/avatar', { preHandler: [authenticate, checkAnyPermission([MODULES.USER_MANAGEMENT, ACTIONS.CREATE], [MODULES.USER_MANAGEMENT, ACTIONS.EDIT])] }, uploadUserAvatarHandler);
  app.put('/users/:userId', { preHandler: [authenticate, checkPermission(MODULES.USER_MANAGEMENT, ACTIONS.EDIT)] }, updateUserHandler);
  app.delete('/users/:userId', { preHandler: [authenticate, checkPermission(MODULES.USER_MANAGEMENT, ACTIONS.DELETE)] }, deleteUserHandler);

  // Evolve technician mapping (admin-only; SA never sees these).
  app.get('/evolve-technicians', { preHandler: [authenticate, checkPermission(MODULES.USER_MANAGEMENT, ACTIONS.VIEW)] }, listEvolveTechniciansHandler);
  app.get('/technician-mappings', { preHandler: [authenticate, checkPermission(MODULES.USER_MANAGEMENT, ACTIONS.VIEW)] }, listTechnicianMappingsHandler);
  app.put('/users/:userId/evolve-technician-no', { preHandler: [authenticate, checkPermission(MODULES.USER_MANAGEMENT, ACTIONS.EDIT)] }, setUserEvolveTechnicianNoHandler);

  // Evolve service-advisor mapping (admin-only).
  app.get('/evolve-service-advisors', { preHandler: [authenticate, checkPermission(MODULES.USER_MANAGEMENT, ACTIONS.VIEW)] }, listEvolveServiceAdvisorsHandler);
  app.get('/service-advisor-mappings', { preHandler: [authenticate, checkPermission(MODULES.USER_MANAGEMENT, ACTIONS.VIEW)] }, listServiceAdvisorMappingsHandler);
  app.put('/users/:userId/evolve-sa-number', { preHandler: [authenticate, checkPermission(MODULES.USER_MANAGEMENT, ACTIONS.EDIT)] }, setUserEvolveSaNumberHandler);
};
