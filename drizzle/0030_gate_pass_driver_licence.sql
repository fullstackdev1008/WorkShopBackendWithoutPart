-- Capture a PHOTO of the driver's licence at gate release (stored as an
-- uploaded image path/URL), instead of a typed licence number.

ALTER TABLE "gate_passes" ADD COLUMN IF NOT EXISTS "driver_out_licence_image_url" text;

-- Drop the earlier licence-number column if it was ever added (no live data).
ALTER TABLE "gate_passes" DROP COLUMN IF EXISTS "driver_out_licence_no";
