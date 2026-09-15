-- Remove display_order from the Labour Master. The Job Card dropdown now orders
-- newest-first (LIFO) by created_at, so an explicit order column is no longer
-- needed. Idempotent.
ALTER TABLE "labour_descriptions" DROP COLUMN IF EXISTS "display_order";
