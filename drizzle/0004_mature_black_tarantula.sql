DROP INDEX IF EXISTS "uq_vehicles_vin";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicles_vin_active" ON "vehicles" USING btree ("vin") WHERE "vehicles"."status" <> 'Archived';