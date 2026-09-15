import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  addVehicle,
  addVehicleMake,
  addVehicleModel,
  deleteVehicle,
  hardDeleteVehicle,
  getVehicleDetails,
  getVehicleMakes,
  getVehicleModels,
  getModelCodes,
  getVehicleVisitHistory,
  listVehicles,
  searchVehicle,
  updateVehicle,
  vinLookup,
  reEntryVehicle,
} from './service';
import { scanPlate } from './plateScan.service';
import { scanLicence } from './licenceScan.service';
import { scanOdometer } from './odometerScan.service';
import { scanFuel } from './fuelScan.service';
import { authenticate, checkPermission, checkAnyPermission } from '../../shared/security/auth.middleware';
import { MODULES, ACTIONS } from '../../shared/security/permissions';
import { HttpStatus } from '../../shared/http/status';
import { serverError } from '../../shared/http/response';

// ─── Handlers ────────────────────────────────────────────────────────────────

const listVehiclesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await listVehicles(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const searchVehicleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await searchVehicle(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const vinLookupHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await vinLookup(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getVehicleMakesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getVehicleMakes(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addVehicleMakeHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addVehicleMake(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getVehicleModelsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getVehicleModels(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getModelCodesHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getModelCodes(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addVehicleModelHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addVehicleModel(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getVehicleDetailsHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getVehicleDetails(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const addVehicleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await addVehicle(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const updateVehicleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await updateVehicle(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const deleteVehicleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await deleteVehicle(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const hardDeleteVehicleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await hardDeleteVehicle(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const reEntryVehicleHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await reEntryVehicle(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const getVehicleVisitHistoryHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await getVehicleVisitHistory(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Gate Entry vision scans ─────────────────────────────────────────────────
// Each scan reads a single multipart `image`, processes it transiently in
// memory and returns a decision. They never throw for a rejected image — the
// result carries a `reason` — so the client can branch on `reason === null`.

const plateScanHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await scanPlate(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const licenceScanHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await scanLicence(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const fuelScanHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await scanFuel(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

const odometerScanHandler = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const result = await scanOdometer(req);
    const code = (result as any).success?.code || (result as any).error?.code;
    res.status(code).send(result);
  } catch (err) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(serverError(err));
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const vehicleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [authenticate, checkAnyPermission([MODULES.GATE_ENTRY, ACTIONS.VIEW], [MODULES.APPOINTMENT, ACTIONS.VIEW])] }, listVehiclesHandler);
  app.get('/search', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.VIEW)] }, searchVehicleHandler);
  app.post('/vin-lookup', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.VIEW)] }, vinLookupHandler);
  app.post('/plate-scan', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.VIEW)] }, plateScanHandler);
  app.post('/licence-scan', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, licenceScanHandler);
  app.post('/odometer-scan', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, odometerScanHandler);
  app.post('/fuel-scan', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, fuelScanHandler);
  app.get('/makes', { preHandler: [authenticate, checkAnyPermission([MODULES.GATE_ENTRY, ACTIONS.VIEW], [MODULES.APPOINTMENT, ACTIONS.VIEW])] }, getVehicleMakesHandler);
  app.post('/makes', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, addVehicleMakeHandler);
  app.get('/makes/:makeId/models', { preHandler: [authenticate, checkAnyPermission([MODULES.GATE_ENTRY, ACTIONS.VIEW], [MODULES.APPOINTMENT, ACTIONS.VIEW])] }, getVehicleModelsHandler);
  app.get('/models/:modelId/codes', { preHandler: [authenticate, checkAnyPermission([MODULES.GATE_ENTRY, ACTIONS.VIEW], [MODULES.APPOINTMENT, ACTIONS.VIEW])] }, getModelCodesHandler);
  app.post('/models', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, addVehicleModelHandler);
  app.get('/:id', { preHandler: [authenticate, checkAnyPermission([MODULES.GATE_ENTRY, ACTIONS.VIEW], [MODULES.VEHICLE_360, ACTIONS.VIEW])] }, getVehicleDetailsHandler);
  app.post('/', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.CREATE)] }, addVehicleHandler);
  app.put('/:id', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.EDIT)] }, updateVehicleHandler);
  app.delete('/:id', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.DELETE)] }, deleteVehicleHandler);
  app.delete('/:id/permanent', { preHandler: [authenticate, checkPermission(MODULES.VEHICLE_360, ACTIONS.DELETE)] }, hardDeleteVehicleHandler);
  app.post('/:id/re-entry', { preHandler: [authenticate, checkPermission(MODULES.GATE_ENTRY, ACTIONS.EDIT)] }, reEntryVehicleHandler);
  app.get('/:id/visit-history', { preHandler: [authenticate, checkAnyPermission([MODULES.VEHICLE_360, ACTIONS.VIEW], [MODULES.GATE_ENTRY, ACTIONS.VIEW])] }, getVehicleVisitHistoryHandler);
};
