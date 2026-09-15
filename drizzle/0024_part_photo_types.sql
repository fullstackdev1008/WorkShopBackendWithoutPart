-- Tech-side part-swap evidence. Splits the single REPAIR bucket into three
-- explicit photo categories so the customer/warranty audit shows the full
-- replacement story:
--   OLD_PART          — the removed part (before/during removal)
--   NEW_PART          — the new part out of the box (before fitting)
--   NEW_PART_FITTED   — the new part installed in the vehicle
-- DIAGNOSIS and REPAIR are kept for back-compat and general-progress shots.

ALTER TYPE "jci_photo_type" ADD VALUE IF NOT EXISTS 'OLD_PART';
ALTER TYPE "jci_photo_type" ADD VALUE IF NOT EXISTS 'NEW_PART';
ALTER TYPE "jci_photo_type" ADD VALUE IF NOT EXISTS 'NEW_PART_FITTED';
