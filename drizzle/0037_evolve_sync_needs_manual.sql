-- Adds the terminal NEEDS_MANUAL state to evolve_sync_status. Idempotent.
-- AMBIGUOUS matches and permanently-UNRESOLVED RO syncs (attempt cap reached)
-- land here and are EXCLUDED from automatic reconcile — re-queued only by an
-- explicit user/system action (picker selection, vehicle edit, manual requeue).
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction on PG < 12,
-- and the new value cannot be USED until the adding statement has committed.
-- This migration only ADDS the value (no usage here), so it is safe to apply
-- standalone. Apply this file before deploying code that writes NEEDS_MANUAL.
ALTER TYPE "evolve_sync_status" ADD VALUE IF NOT EXISTS 'NEEDS_MANUAL';
