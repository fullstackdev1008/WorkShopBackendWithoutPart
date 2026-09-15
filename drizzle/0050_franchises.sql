-- AI-3 — Labeled Franchise / Service-Dept selection on the job card.
--
-- Evolve's RO screen has two dropdowns (Franchise → Service Dept) whose options
-- are named ("FAW", "Service - FAW") but map to numeric FranchiseSeqID / SDNumber
-- sent in the RO XML. The `franchise_service_departments` cache already holds the
-- valid (FranchiseSeqID, SDNumber) pairs (populated by master-data sync from
-- IRM_GetLookupDropdownTables). We add the human labels the admin assigns to each
-- pair after sync ("sync then label"), so the FE can show two dependent dropdowns
-- and store the chosen pair on the job card.
--
-- This REPLACES the make-based auto-resolution: RO franchise now comes from the
-- job card's selected pair. Blank selection → the existing '1' / '1' fallback in
-- the XML builder is unchanged. Labels are client-supplied; nothing is guessed.
-- Additive + idempotent.

ALTER TABLE "franchise_service_departments"
  ADD COLUMN IF NOT EXISTS "franchise_label"    varchar(100),
  ADD COLUMN IF NOT EXISTS "service_dept_label" varchar(100);

-- Job card's chosen Franchise/Service-Dept pair (the leaf; FranchiseSeqID is
-- derived from it). ON DELETE SET NULL so removing a cached pair leaves history
-- intact (those job cards fall back to '1' / '1' at sync).
ALTER TABLE "job_cards"
  ADD COLUMN IF NOT EXISTS "franchise_service_dept_id" uuid
    REFERENCES "franchise_service_departments" ("id") ON DELETE SET NULL;
