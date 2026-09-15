import { FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { syncAllMasterData } from '../../services/masterDataSync.service';
import { db } from '../../db';
import { jobCards } from '../../db/models';
import { env } from '../../config/env';
import { checkEvolveReadiness } from '../../db/health';
import { success, error, serverError } from '../../shared/http/response';
import { HttpStatus } from '../../shared/http/status';

export async function triggerMasterDataSync(_request: FastifyRequest) {
  try {
    const result = await syncAllMasterData();
    return success('Master data sync completed successfully', result);
  } catch (err) {
    console.log('error :- ', err);
    return serverError(err);
  }
}

// GET /api/sync/evolve-health — feature mode, schema readiness, and a breakdown
// of job cards by Evolve sync status (incl. the NEEDS_MANUAL review backlog).
export async function getEvolveSyncHealth(_request: FastifyRequest) {
  try {
    const readiness = await checkEvolveReadiness();
    const countsByStatus: Record<string, number> = {};
    let needsManual = 0;

    if (readiness.jobCardSyncReady) {
      const res = (await db.execute(sql`
        SELECT COALESCE(evolve_sync_status::text, 'UNSET') AS status, COUNT(*)::int AS n
        FROM job_cards
        GROUP BY 1
      `)) as unknown as { rows?: Array<{ status: string; n: number }> };
      for (const r of res.rows ?? []) {
        countsByStatus[r.status] = r.n;
        if (r.status === 'NEEDS_MANUAL') needsManual = r.n;
      }
    }

    return success('Evolve sync health', {
      modelCodeMode: env.EVOLVE_MODELCODE_MODE,
      engineNumberMode: env.EVOLVE_ENGINE_NUMBER_MODE,
      jobCardSyncEnabled: env.EVOLVE_JOB_CARD_SYNC_ENABLED,
      syncFrozen: env.EVOLVE_SYNC_FREEZE,
      identityUpdateVerified: env.EVOLVE_IDENTITY_UPDATE_VERIFIED,
      catalogWarmEnabled: env.EVOLVE_CATALOG_WARM_ENABLED,
      readiness,
      countsByStatus,
      needsManual,
    });
  } catch (err) {
    return serverError(err);
  }
}

// POST /api/sync/job-card/:id/requeue — explicit user action that moves a card
// out of the terminal NEEDS_MANUAL (or any unsynced) state back to PENDING so
// the next reconcile re-attempts it (e.g. after a model_code was picked/fixed).
export async function requeueJobCardSync(request: FastifyRequest) {
  try {
    const { id } = request.params as { id: string };
    if (!id) return error(HttpStatus.BAD_REQUEST, 'job card id required');

    const [row] = await db
      .select({ id: jobCards.id, status: jobCards.evolveSyncStatus, ro: jobCards.evolveRoNumber })
      .from(jobCards)
      .where(eq(jobCards.id, id))
      .limit(1);
    if (!row) return error(HttpStatus.NOT_FOUND, 'job card not found');
    if (row.ro) return error(HttpStatus.BAD_REQUEST, 'job card already synced (has RO number)');

    await db
      .update(jobCards)
      .set({ evolveSyncStatus: 'PENDING', evolveAttemptCount: 0, evolveNextAttemptAt: null, evolveLastError: null, updatedAt: new Date() })
      .where(eq(jobCards.id, id));

    return success('Job card re-queued for Evolve sync', { id, previousStatus: row.status });
  } catch (err) {
    return serverError(err);
  }
}
