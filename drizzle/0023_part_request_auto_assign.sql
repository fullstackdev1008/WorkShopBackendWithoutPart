-- When a tech raises an extra part mid-repair and the customer eventually
-- approves it, we auto-assign the supplementary job_card_items row back
-- to the same tech (they're already on the vehicle, no SA handoff needed).
-- Two breadcrumbs are needed:
--   requested_by               — which user raised the request
--   supp_job_card_item_id      — which jobCardItems row the PM inserted
--                                when marking the request Available, so the
--                                approval hook updates the right row.

ALTER TABLE "part_requests"
  ADD COLUMN IF NOT EXISTS "requested_by"          uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "supp_job_card_item_id" uuid REFERENCES "job_card_items"("id") ON DELETE SET NULL;
