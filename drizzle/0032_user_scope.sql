-- Phase 4 Step 1 — User-level record scoping. Additive + idempotent.
--   shop_scope    pins a foreman/controller to one shop; ALL = unrestricted.
--   warranty_only restricts a clerk to WARRANTY_SERVICE job cards.
-- Both carry safe defaults so every EXISTING user is unaffected until a scope
-- is deliberately assigned. This is a scoping layer ON TOP of RBAC — it does
-- not change any permission, role, or the super-admin bypass.

-- 1. Enum type (idempotent — re-applies safely on push/re-run).
DO $$ BEGIN
  CREATE TYPE "public"."user_shop_scope" AS ENUM('SERVICE', 'MAJOR', 'ALL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Columns on users. NOT NULL with defaults → existing rows backfill to the
--    unrestricted defaults automatically; no behavior change at enforcement-off.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "shop_scope" "user_shop_scope" NOT NULL DEFAULT 'ALL';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "warranty_only" boolean NOT NULL DEFAULT false;
