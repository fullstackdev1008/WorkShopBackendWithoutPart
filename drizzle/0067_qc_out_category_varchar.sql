-- Widen qc_out_inspection_items.category from the qc_category enum to varchar,
-- finishing the job 0060_qc_truck_checklist started.
--
-- 0060 widened qc_inspection_items.category (QC In) to varchar so the truck
-- sheet's categories (Engine, Cooling System, …) could be stored, and noted
-- "the qc_category enum type is kept (still used by QC-Out)". But QC Out
-- MIRRORS QC In — qc_out_inspection_items.category is copied straight from the
-- matching QC In item so the two can be compared row-by-row. So submitting a
-- QC Out for any truck-checklist inspection fails with:
--     invalid input value for enum qc_category: "Engine"   (SQLSTATE 22P02)
--
-- HISTORY-PRESERVING: existing rows keep their text values (EXTERIOR/INTERIOR/
-- BRAKE); the cast is USING category::text so nothing is lost. Widening only
-- ever accepts more values, so no existing QC Out record becomes invalid.
--
-- The qc_category enum type itself is left in place — dropping it would break
-- anything still referencing it, and an unused type costs nothing.
--
-- Idempotent: the DO block skips the ALTER when the column is already varchar.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'qc_out_inspection_items'
       AND column_name  = 'category'
       AND udt_name     = 'qc_category'
  ) THEN
    ALTER TABLE "qc_out_inspection_items"
      ALTER COLUMN "category" TYPE varchar(100) USING "category"::text;
  END IF;
END $$;
