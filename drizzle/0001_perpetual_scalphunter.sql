DO $$ BEGIN
 CREATE TYPE "public"."fuel_level" AS ENUM('EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTER', 'FULL');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."gate_pass_status" AS ENUM('ACTIVE', 'REDEEMED', 'VOIDED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."invoice_line_source" AS ENUM('JOB_CARD_ITEM', 'ADJUSTMENT');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'GENERATED', 'PARTIALLY_PAID', 'PAID', 'VOID');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."jci_photo_type" AS ENUM('DIAGNOSIS', 'REPAIR', 'OLD_PART', 'NEW_PART', 'NEW_PART_FITTED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_audience" AS ENUM('CUSTOMER', 'TECHNICIAN', 'FOREMAN', 'SA', 'PARTS', 'MANAGER', 'CONTROLLER');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_channel" AS ENUM('WHATSAPP', 'EMAIL', 'INAPP');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_level" AS ENUM('INFO', 'WARN', 'CRIT');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_status" AS ENUM('sent', 'failed', 'skipped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_trigger" AS ENUM('RO_STATUS', 'APPROVAL', 'LABOUR_80', 'LABOUR_100', 'QC_FAIL');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."payment_mode" AS ENUM('CASH', 'CARD', 'UPI', 'BANK', 'CHEQUE');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."qc_out_item_status" AS ENUM('PASS', 'FAIL', 'NA');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."qc_out_overall" AS ENUM('PASS', 'FAIL');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."repair_category" AS ENUM('ENGINE', 'TRANSMISSION', 'ELECTRICAL', 'BRAKES', 'BODY', 'AC', 'OTHER');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."warranty_status" AS ENUM('HELD', 'PENDING_APPROVAL', 'APPROVED', 'SCRAPPED', 'REJECTED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."workshop_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "vehicle_photo_type" ADD VALUE IF NOT EXISTS 'DAMAGE';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_card_item_reassignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_card_item_id" uuid NOT NULL,
	"from_tech_id" uuid,
	"to_tech_id" uuid,
	"reassigned_by" uuid,
	"reason" text,
	"prior_seconds" integer DEFAULT 0 NOT NULL,
	"reassigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ro_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_in_id" uuid NOT NULL,
	"from_status" varchar(40),
	"to_status" varchar(40) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user_id" uuid,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workshop_bays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bay_no" varchar(20) NOT NULL,
	"location" varchar(100),
	"capabilities" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"current_allocation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workshop_bays_bay_no_unique" UNIQUE("bay_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workshop_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_in_id" uuid NOT NULL,
	"bay_id" uuid NOT NULL,
	"priority" "workshop_priority" DEFAULT 'MEDIUM' NOT NULL,
	"repair_category" "repair_category" DEFAULT 'OTHER' NOT NULL,
	"notes" text,
	"allocated_by" uuid,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_card_item_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_card_item_id" uuid NOT NULL,
	"photo_type" "jci_photo_type" NOT NULL,
	"image_url" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "technician_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technician_id" uuid NOT NULL,
	"skill" "repair_category" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_tech_skill" UNIQUE("technician_id","skill")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_templates" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_type" "notification_trigger" NOT NULL,
	"trigger_value" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"audience" "notification_audience" NOT NULL,
	"template_key" varchar(60) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"level" "notification_level" DEFAULT 'INFO' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"audience" "notification_audience" NOT NULL,
	"recipient" text NOT NULL,
	"template_key" varchar(60),
	"ref_type" text,
	"ref_id" uuid,
	"status" "notification_status" NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_out_checklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_out_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_in_id" uuid NOT NULL,
	"overall_status" "qc_out_overall" NOT NULL,
	"final_remarks" text,
	"inspector_id" uuid,
	"signature_image_url" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_out_inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"item_label" text NOT NULL,
	"status" "qc_out_item_status" NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_out_inspection_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"item_id" uuid,
	"image_url" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_out_work_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qc_out_inspection_id" uuid,
	"check_in_id" uuid NOT NULL,
	"job_card_item_id" uuid NOT NULL,
	"result" varchar(10),
	"notes" text,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warranty_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag_no" varchar(20) NOT NULL,
	"job_card_item_id" uuid,
	"vehicle_id" uuid,
	"customer_id" uuid,
	"part_name" text NOT NULL,
	"part_number" text,
	"warranty_claim_no" varchar(60),
	"warranty_oem" varchar(120),
	"technician_id" uuid,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "warranty_status" DEFAULT 'HELD' NOT NULL,
	"approval_doc_url" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"scrapped_at" timestamp with time zone,
	"scrapped_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warranty_parts_tag_no_unique" UNIQUE("tag_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"source" "invoice_line_source" NOT NULL,
	"ref_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_warranty" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"reference_no" varchar(120),
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_no" varchar(30) NOT NULL,
	"job_card_id" uuid NOT NULL,
	"check_in_id" uuid,
	"vehicle_id" uuid,
	"customer_id" uuid,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_label" varchar(20) DEFAULT 'GST' NOT NULL,
	"tax_percentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency_code" varchar(3) DEFAULT 'USD' NOT NULL,
	"notes" text,
	"generated_at" timestamp with time zone,
	"generated_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_no_unique" UNIQUE("invoice_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gate_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"invoice_id" uuid NOT NULL,
	"check_in_id" uuid,
	"vehicle_id" uuid,
	"status" "gate_pass_status" DEFAULT 'ACTIVE' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" uuid,
	"odometer_out" integer,
	"driver_out_name" varchar(150),
	"driver_out_signature_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gate_passes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "receiving_no" varchar(20);--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "driver_name" varchar(150);--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "driver_phone" varchar(30);--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "driver_licence_no" varchar(50);--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "fuel_level" "fuel_level";--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "damages_notes" text;--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "complaint_text" text;--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "ro_status" varchar(40);--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "ro_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicle_check_ins" ADD COLUMN IF NOT EXISTS "ro_status_by" uuid;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "rework_notes" text;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "rework_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "diagnosis_notes" text;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "diagnosed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "diagnosed_by" uuid;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "signature_image_url" text;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "alerted_80pct_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "alerted_100pct_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "is_warranty_claim" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "warranty_claim_no" varchar(60);--> statement-breakpoint
ALTER TABLE "job_card_items" ADD COLUMN IF NOT EXISTS "warranty_oem" varchar(120);--> statement-breakpoint
ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "requested_by_technician" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "extra_labour_cost" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "customer_approval_status" varchar(20) DEFAULT 'NOT_REQUIRED' NOT NULL;--> statement-breakpoint
ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "part_requests" ADD COLUMN IF NOT EXISTS "supp_job_card_item_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_item_reassignments" ADD CONSTRAINT "job_card_item_reassignments_job_card_item_id_job_card_items_id_fk" FOREIGN KEY ("job_card_item_id") REFERENCES "public"."job_card_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_item_reassignments" ADD CONSTRAINT "job_card_item_reassignments_from_tech_id_users_id_fk" FOREIGN KEY ("from_tech_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_item_reassignments" ADD CONSTRAINT "job_card_item_reassignments_to_tech_id_users_id_fk" FOREIGN KEY ("to_tech_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_item_reassignments" ADD CONSTRAINT "job_card_item_reassignments_reassigned_by_users_id_fk" FOREIGN KEY ("reassigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ro_status_history" ADD CONSTRAINT "ro_status_history_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ro_status_history" ADD CONSTRAINT "ro_status_history_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workshop_allocations" ADD CONSTRAINT "workshop_allocations_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workshop_allocations" ADD CONSTRAINT "workshop_allocations_bay_id_workshop_bays_id_fk" FOREIGN KEY ("bay_id") REFERENCES "public"."workshop_bays"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workshop_allocations" ADD CONSTRAINT "workshop_allocations_allocated_by_users_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_item_photos" ADD CONSTRAINT "job_card_item_photos_job_card_item_id_job_card_items_id_fk" FOREIGN KEY ("job_card_item_id") REFERENCES "public"."job_card_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_item_photos" ADD CONSTRAINT "job_card_item_photos_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician_skills" ADD CONSTRAINT "technician_skills_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_template_key_notification_templates_key_fk" FOREIGN KEY ("template_key") REFERENCES "public"."notification_templates"("key") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_inspections" ADD CONSTRAINT "qc_out_inspections_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_inspections" ADD CONSTRAINT "qc_out_inspections_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_inspection_items" ADD CONSTRAINT "qc_out_inspection_items_inspection_id_qc_out_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."qc_out_inspections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_inspection_photos" ADD CONSTRAINT "qc_out_inspection_photos_inspection_id_qc_out_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."qc_out_inspections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_inspection_photos" ADD CONSTRAINT "qc_out_inspection_photos_item_id_qc_out_inspection_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."qc_out_inspection_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_inspection_photos" ADD CONSTRAINT "qc_out_inspection_photos_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_work_verifications" ADD CONSTRAINT "qc_out_work_verifications_qc_out_inspection_id_qc_out_inspections_id_fk" FOREIGN KEY ("qc_out_inspection_id") REFERENCES "public"."qc_out_inspections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_work_verifications" ADD CONSTRAINT "qc_out_work_verifications_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_work_verifications" ADD CONSTRAINT "qc_out_work_verifications_job_card_item_id_job_card_items_id_fk" FOREIGN KEY ("job_card_item_id") REFERENCES "public"."job_card_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_out_work_verifications" ADD CONSTRAINT "qc_out_work_verifications_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_parts" ADD CONSTRAINT "warranty_parts_job_card_item_id_job_card_items_id_fk" FOREIGN KEY ("job_card_item_id") REFERENCES "public"."job_card_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_parts" ADD CONSTRAINT "warranty_parts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_parts" ADD CONSTRAINT "warranty_parts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_parts" ADD CONSTRAINT "warranty_parts_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_parts" ADD CONSTRAINT "warranty_parts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_parts" ADD CONSTRAINT "warranty_parts_scrapped_by_users_id_fk" FOREIGN KEY ("scrapped_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jci_reassign_item" ON "job_card_item_reassignments" USING btree ("job_card_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jci_reassign_at" ON "job_card_item_reassignments" USING btree ("reassigned_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ro_status_history_check_in_id" ON "ro_status_history" USING btree ("check_in_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ro_status_history_at" ON "ro_status_history" USING btree ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_allocations_check_in" ON "workshop_allocations" USING btree ("check_in_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_allocations_bay" ON "workshop_allocations" USING btree ("bay_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jci_photos_item" ON "job_card_item_photos" USING btree ("job_card_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jci_photos_type" ON "job_card_item_photos" USING btree ("job_card_item_id","photo_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tech_skills_tech" ON "technician_skills" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tech_skills_skill" ON "technician_skills" USING btree ("skill");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_log_ref" ON "notification_log" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_log_sent_at" ON "notification_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_out_check_in" ON "qc_out_inspections" USING btree ("check_in_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_out_completed_at" ON "qc_out_inspections" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_out_items_inspection" ON "qc_out_inspection_items" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_out_photos_inspection" ON "qc_out_inspection_photos" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_out_work_verif_inspection" ON "qc_out_work_verifications" USING btree ("qc_out_inspection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_out_work_verif_check_in" ON "qc_out_work_verifications" USING btree ("check_in_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_out_work_verif_item" ON "qc_out_work_verifications" USING btree ("job_card_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_warranty_status" ON "warranty_parts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_warranty_vehicle" ON "warranty_parts" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_warranty_customer" ON "warranty_parts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_warranty_removed" ON "warranty_parts" USING btree ("removed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoice_lines_invoice" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoice_payments_invoice" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_job_card" ON "invoices" USING btree ("job_card_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_check_in" ON "invoices" USING btree ("check_in_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_status" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_customer" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gate_passes_invoice" ON "gate_passes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gate_passes_check_in" ON "gate_passes" USING btree ("check_in_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gate_passes_status" ON "gate_passes" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_check_ins" ADD CONSTRAINT "vehicle_check_ins_ro_status_by_users_id_fk" FOREIGN KEY ("ro_status_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_items" ADD CONSTRAINT "job_card_items_diagnosed_by_users_id_fk" FOREIGN KEY ("diagnosed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_supp_job_card_item_id_job_card_items_id_fk" FOREIGN KEY ("supp_job_card_item_id") REFERENCES "public"."job_card_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION

 WHEN duplicate_object THEN null;
END $$;
