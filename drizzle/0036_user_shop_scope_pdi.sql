-- Add 'PDI' to the user_shop_scope enum so users can be scoped to the PDI shop.
-- vehicle_check_ins.shop (bay_category) already supports 'PDI'; this aligns the
-- user-side scope so PDI Foreman / PDI Controller users see only PDI vehicles.
-- Additive + idempotent. Must run OUTSIDE a transaction (ALTER TYPE ADD VALUE),
-- which the raw-SQL apply path already does.
ALTER TYPE "public"."user_shop_scope" ADD VALUE IF NOT EXISTS 'PDI';
