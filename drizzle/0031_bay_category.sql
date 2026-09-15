-- Bay categories (Service / Major / PDI) so the foreman can pick a category
-- first and only see bays of that type during allocation.

-- 1. Enum type (idempotent — Drizzle's raw runner re-applies on push).
DO $$ BEGIN
  CREATE TYPE "public"."bay_category" AS ENUM('SERVICE', 'MAJOR', 'PDI');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Nullable column on workshop_bays. Nullable so existing/legacy bays remain
--    valid; they simply won't appear under any category filter.
ALTER TABLE "workshop_bays" ADD COLUMN IF NOT EXISTS "category" "bay_category";
