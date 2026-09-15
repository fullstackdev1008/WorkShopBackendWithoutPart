-- Per-job Evolve AR account number → RO <ROJobHeader><ARAccountNo>.
--
-- WHY: Evolve refuses to load a labour line under Cost Jobs when the customer
-- has no AR (Accounts Receivable) master record — observed live on RO FO008450
-- as "No artArMaster Record Available". The RO contract
-- (15a_ROMaintenance_Request.xml) carries <ARAccountNo> inside each
-- <ROJobHeader><RowDetails>, and we have never populated it.
--
-- A customer can hold SEVERAL AR accounts — one per department type
-- (03b_CustomerLookup_Response documents PartsType / VehicleType / ServiceType /
-- ForecourtType; a live 20EC lookup returned ArAccountType 'VH' =
-- "Retail Vehicles"). Which one an RO should be charged to is therefore an
-- operator choice, not something we can derive — hence a stored selection.
--
-- WHY ON job_card_items: the Job Type that triggers the selection is already
-- per-job (job_card_items.job_type, flattened from the job group), and
-- <ARAccountNo> likewise sits per job inside ROJobHeader. Storing it beside
-- job_type keeps the two on the same grain, so buildRoInput can read both from
-- the same grouped rows.
--
-- Nullable with no default: a job that needs no AR account (cash work) simply
-- has none, and the RO builder omits the element rather than sending a blank —
-- the same convention as <EngineNumber>. varchar(40) matches
-- customer_ar.ar_account_number so a value mirrored from Evolve can never be
-- truncated on the way through (the contract itself documents x(12)).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "job_card_items"
  ADD COLUMN IF NOT EXISTS "evolve_ar_account_no" varchar(40);
