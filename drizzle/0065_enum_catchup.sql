-- Enum-value catch-up: labels that exist in src/db/models/enums.ts but were
-- never added to a migration file, so a freshly-pointed DATABASE_URL rejects
-- them with 22P02 (invalid input value for enum) at runtime.
--
-- job_card_status     FOREMAN_REVIEW / FOREMAN_REJECTED — the foreman sign-off
--                     flow (job_cards.foreman_* columns, added in 0064).
-- part_request_status accepted / rejected — technician accept/reject of a
--                     dispatched part (part_requests.accepted_* /
--                     tech_rejected_* columns, also added in 0064).
--
-- Position matches the model's declared order so enum comparisons and ORDER BY
-- behave the same as on local/UAT. Idempotent via IF NOT EXISTS.
-- NOTE: ALTER TYPE ... ADD VALUE must not run in the same transaction that uses
-- the new label — apply this file outside an explicit transaction block.

ALTER TYPE "job_card_status" ADD VALUE IF NOT EXISTS 'FOREMAN_REVIEW'   BEFORE 'COMPLETED';
ALTER TYPE "job_card_status" ADD VALUE IF NOT EXISTS 'FOREMAN_REJECTED' BEFORE 'COMPLETED';

ALTER TYPE "part_request_status" ADD VALUE IF NOT EXISTS 'accepted' AFTER 'dispatched';
ALTER TYPE "part_request_status" ADD VALUE IF NOT EXISTS 'rejected' AFTER 'accepted';
