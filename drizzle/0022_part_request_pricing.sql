-- When a tech raises a part mid-repair, the customer originally approved
-- only the SA's first estimate. So when the Parts Manager marks the
-- tech-raised part as Available, we need to capture the unit price, bump
-- the parent item's cost, and re-share the estimate with the customer.
-- Status tracks where the per-request approval stands so the technician's
-- completion gate can refuse work until the customer signs off.

ALTER TABLE "part_requests"
  ADD COLUMN IF NOT EXISTS "unit_price"               numeric(12,2),
  ADD COLUMN IF NOT EXISTS "extra_labour_cost"        numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "customer_approval_status" varchar(20)   NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS "approved_at"              timestamptz,
  ADD COLUMN IF NOT EXISTS "rejected_at"              timestamptz;
-- Values: NOT_REQUIRED | PENDING | APPROVED | REJECTED
