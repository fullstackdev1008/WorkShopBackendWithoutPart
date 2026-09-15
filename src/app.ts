import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';

import { env } from './config/env';
import { errorHandler } from './shared/errors/appError';

import { authRoutes } from './modules/auth/routes';
import { customerRoutes } from './modules/customers/routes';
import { vehicleRoutes } from './modules/vehicles/routes';
import { vehicleImageRoutes } from './modules/vehicle-images/routes';
import { confirmEntryRoutes } from './modules/confirm-entry/routes';
import { vehicleAccessoryRoutes } from './modules/vehicle-accessories/routes';
import { vehicleCheckInRoutes } from './modules/vehicle-checkin/routes';
import { qcInspectionRoutes } from './modules/qc-inspections/routes';
import { qcChecklistTemplateRoutes } from './modules/qc-checklist-templates/routes';
import { appointmentRoutes } from './modules/appointments/routes';
import { complaintRoutes } from './modules/complaints/routes';
import { serviceTypeRoutes } from './modules/service-types/routes';
import { jobTypeRoutes } from './modules/job-types/routes';
import { slotConfigurationRoutes } from './modules/slot-configurations/routes';
import { serviceAdvisorRoutes } from './modules/service-advisors/routes';
import { workshopRoutes } from './modules/workshop/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { runLabourAlertCheck } from './modules/notifications/service';
import { reconcileUnsyncedCustomers } from './services/customerEvolveSync.service';
import { reconcileUnsyncedJobCards } from './services/jobCardEvolveSync.service';
import { warmCatalogForUnresolvedMakes } from './services/modelCodeCatalogWarm.service';
import { checkEvolveReadiness } from './db/health';
import { withAdvisoryLock, LOCK_KEYS } from './shared/utils/pgAdvisoryLock';
import { qcOutRoutes } from './modules/qc-out/routes';
import { washbayRoutes } from './modules/washbay/routes';
import { partsManagerRoutes } from './modules/parts-manager/routes';
import { partsRoutes } from './modules/parts/routes';
import { modelServiceTypeRoutes } from './modules/model-service-types/routes';
import { userManagementRoutes } from './modules/user-management/routes';
import { designationRoutes } from './modules/designations/routes';
import { labourDescriptionRoutes } from './modules/labour-descriptions/routes';
import { franchiseServiceDeptRoutes } from './modules/franchise-service-depts/routes';
import { settingsRoutes } from './modules/settings/routes';
import { syncRoutes } from './modules/sync/routes';
import { companyRoutes } from './modules/companies/routes';
import { customerApprovalRoutes } from './modules/customer-approval/routes';
import { dbDumpRoutes } from './modules/db-dump/routes';
import { seedRoutes } from './modules/seed/routes';
import { warrantyRoutes } from './modules/warranty/routes';
import { invoicingRoutes } from './modules/invoicing/routes';
import { gatePassRoutes } from './modules/gate-pass/routes';
import { vehicle360Routes } from './modules/vehicle-360/routes';

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'warn' : 'info' },
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  if (env.USE_LOCAL_STORAGE) {
    const uploadsDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    await app.register(staticFiles, { root: uploadsDir, prefix: '/uploads/' });
  }

  await app.register(multipart, {
    limits: { fileSize: env.MAX_FILE_SIZE, files: 8 },
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(customerRoutes, { prefix: '/api/customers' });
  await app.register(vehicleRoutes, { prefix: '/api/vehicles' });
  await app.register(vehicleImageRoutes, { prefix: '/api/vehicles' });
  await app.register(confirmEntryRoutes, { prefix: '/api/vehicles' });
  await app.register(vehicleAccessoryRoutes, { prefix: '/api/vehicles' });
  await app.register(vehicleCheckInRoutes, { prefix: '/api/check-ins' });
  await app.register(qcInspectionRoutes, { prefix: '/api/qc-inspections' });
  await app.register(qcChecklistTemplateRoutes, { prefix: '/api/qc-checklist-templates' });
  await app.register(appointmentRoutes, { prefix: '/api/appointments' });
  await app.register(complaintRoutes, { prefix: '/api/complaints' });
  await app.register(serviceTypeRoutes, { prefix: '/api/service-types' });
  await app.register(jobTypeRoutes, { prefix: '/api/job-types' });
  await app.register(slotConfigurationRoutes, { prefix: '/api/slot-configurations' });
  await app.register(serviceAdvisorRoutes, { prefix: '/api/service-advisor' });
  await app.register(workshopRoutes, { prefix: '/api/workshop' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(qcOutRoutes, { prefix: '/api/qc-out' });
  await app.register(washbayRoutes, { prefix: '/api/washbay' });

  // Phase 4 — labour-overrun alert cron. Runs every 5 minutes in-process.
  // For multi-instance deployments, lift this to an external scheduler so
  // only one node runs the check at a time.
  const LABOUR_CHECK_MS = 5 * 60 * 1000;
  setInterval(() => { runLabourAlertCheck(); }, LABOUR_CHECK_MS);

  // Evolve customer-sync reconciliation cron. Only registered when the feature
  // flag is on; re-pushes customers still on a placeholder cust_sequence_id
  // (failed/never-synced). Idempotent. Like the labour cron, move to an external
  // scheduler for multi-instance deployments.
  if (env.EVOLVE_CUSTOMER_SYNC_ENABLED) {
    const EVOLVE_RECONCILE_MS = 15 * 60 * 1000;
    setInterval(() => { reconcileUnsyncedCustomers().catch(() => { /* logged inside */ }); }, EVOLVE_RECONCILE_MS);
  }

  // Evolve schema-readiness probe (C4). Caches readiness flags consumed by the
  // RO-sync service so it self-disables instead of crash-looping when migrations
  // 0028/0035/0037/0038 are absent.
  const evolveReady = await checkEvolveReadiness();
  if (evolveReady.missing.length) {
    console.warn('[Evolve] schema readiness — missing:', evolveReady.missing.join('; '));
  }
  if (env.EVOLVE_MODELCODE_MODE === 'ENFORCE' && !(evolveReady.modelCatalogReady && evolveReady.jobCardSyncReady)) {
    console.error('[Evolve] EVOLVE_MODELCODE_MODE=ENFORCE but required schema is missing — ENFORCE cannot engage. Apply migrations 0028/0035/0037/0038.');
  }
  // Fail-open visibility: a live RO sync in any non-ENFORCE mode can transmit a
  // blank ModelCode to Evolve (legacy/shadow behaviour). Surface it loudly so an
  // operator who wants the fail-closed guarantee knows to set ENFORCE.
  if (env.EVOLVE_JOB_CARD_SYNC_ENABLED && env.EVOLVE_MODELCODE_MODE !== 'ENFORCE') {
    console.warn(`[Evolve] EVOLVE_JOB_CARD_SYNC_ENABLED=true with EVOLVE_MODELCODE_MODE=${env.EVOLVE_MODELCODE_MODE} — RO requests may carry a blank ModelCode (fail-open). Set EVOLVE_MODELCODE_MODE=ENFORCE for the fail-closed guarantee.`);
  }

  // Evolve job-card-sync reconciliation cron. Registered only when the feature
  // flag is on AND the required schema is present (otherwise the sweep would
  // throw per-card). Mirrors the customer reconcile; lift to an external
  // scheduler + leader lock for multi-instance deployments.
  if (env.EVOLVE_JOB_CARD_SYNC_ENABLED && evolveReady.jobCardSyncReady) {
    const EVOLVE_JC_RECONCILE_MS = 15 * 60 * 1000;
    // Advisory lock (H3): only the instance that acquires the lock runs the
    // sweep, so multiple nodes can't create duplicate ROs for the same cards.
    setInterval(() => {
      void withAdvisoryLock(LOCK_KEYS.JOB_CARD_RECONCILE, () => reconcileUnsyncedJobCards())
        .catch(() => { /* logged inside */ });
    }, EVOLVE_JC_RECONCILE_MS);
  } else if (env.EVOLVE_JOB_CARD_SYNC_ENABLED && !evolveReady.jobCardSyncReady) {
    console.error('[Evolve] EVOLVE_JOB_CARD_SYNC_ENABLED is on but job-card sync schema is missing — reconcile disabled. Apply migrations 0035/0037/0038.');
  }

  // Out-of-band catalog warm cron — populates Make→Series→ModelCode so the
  // read-only resolver has data. Gated by EVOLVE_CATALOG_WARM_ENABLED and the
  // catalog schema; leader-locked so only one instance sweeps. Never on the
  // RO sync path.
  if (env.EVOLVE_CATALOG_WARM_ENABLED && evolveReady.modelCatalogReady) {
    const EVOLVE_WARM_MS = 60 * 60 * 1000; // hourly; per-make TTL throttles further
    setInterval(() => {
      void withAdvisoryLock(LOCK_KEYS.CATALOG_WARM, () => warmCatalogForUnresolvedMakes())
        .catch(() => { /* logged inside */ });
    }, EVOLVE_WARM_MS);
  }

  // (Part-ETA auto-promotion cron removed — ETAs are estimates only.
  // The PM dispatches directly from the Unavailable list when the part
  // physically arrives, regardless of the ETA.)
  await app.register(partsManagerRoutes, { prefix: '/api/parts-manager' });
  await app.register(partsRoutes, { prefix: '/api/parts' });
  await app.register(modelServiceTypeRoutes, { prefix: '/api/model-service-type-assignments' });
  await app.register(userManagementRoutes, { prefix: '/api/user-management' });
  await app.register(designationRoutes, { prefix: '/api/designations' });
  await app.register(labourDescriptionRoutes, { prefix: '/api/labour-descriptions' });
  await app.register(franchiseServiceDeptRoutes, { prefix: '/api/franchise-service-depts' });
  await app.register(settingsRoutes, { prefix: '/api/admin/settings' });
  await app.register(syncRoutes, { prefix: '/api/sync' });
  await app.register(companyRoutes, { prefix: '/api/companies' });
  await app.register(dbDumpRoutes, { prefix: '/api/db' });
  await app.register(customerApprovalRoutes, { prefix: '/api/customer-approval' });
  await app.register(seedRoutes, { prefix: '/api/seed' });
  await app.register(warrantyRoutes, { prefix: '/api/warranty' });
  await app.register(invoicingRoutes, { prefix: '/api/invoicing' });
  await app.register(gatePassRoutes, { prefix: '/api/gate-pass' });
  await app.register(vehicle360Routes, { prefix: '/api/vehicle-360' });

  app.get('/health', async (_req, reply) =>
    reply.code(200).send({ status: true, message: 'Workshop API is running', timestamp: new Date().toISOString() }),
  );

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ status: false, message: 'Route not found' }),
  );

  app.setErrorHandler(errorHandler);

  return app;
}
