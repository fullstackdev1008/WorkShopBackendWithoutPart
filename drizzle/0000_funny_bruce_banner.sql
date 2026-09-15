DO $$ BEGIN
 CREATE TYPE "public"."appointment_status" AS ENUM('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."job_card_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."job_card_status" AS ENUM('DRAFT', 'PENDING_PARTS', 'PARTS_CONFIRMED', 'SHARED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'MODIFICATION_REQUESTED', 'IN_PROGRESS', 'IN_SERVICE', 'COMPLETED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_status" AS ENUM('pending', 'available', 'unavailable', 'dispatched');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."qc_category" AS ENUM('EXTERIOR', 'INTERIOR', 'BRAKE');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."qc_inspection_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."qc_item_result" AS ENUM('PASS', 'FAIL', 'NA');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."qc_overall_status" AS ENUM('PASS', 'CONDITIONAL', 'FAIL');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vehicle_check_in_status" AS ENUM('IN_QUEUE', 'IN_SERVICE', 'READY', 'COMPLETED', 'CANCELLED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vehicle_photo_type" AS ENUM('FRONT', 'REAR', 'LEFT', 'RIGHT', 'DASHBOARD', 'ENGINE', 'OTHER');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"role_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"jti" varchar(100) NOT NULL,
	"ip_address" varchar(45),
	"user_agent" varchar(500),
	"is_revoked" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"resource" varchar(100) NOT NULL,
	"action" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crm_reference_no" varchar(50) NOT NULL,
	"cust_sequence_id" varchar(40) NOT NULL,
	"customer_type" varchar(1) NOT NULL,
	"title" varchar(20),
	"initial" varchar(10),
	"first_name" varchar(150),
	"last_name" varchar(150),
	"company_name" varchar(100),
	"trading_as" varchar(100),
	"id_number" varchar(20),
	"birth_date" date,
	"gender" varchar(1),
	"marital_status" integer,
	"language" varchar(1),
	"citizen" boolean,
	"internal_customer" boolean,
	"locked" boolean,
	"active_customer" boolean NOT NULL,
	"customer_personal" varchar(1),
	"status" integer,
	"finance_institution" varchar(1),
	"customer_sales_type" varchar(1),
	"primary_email" varchar(100),
	"secondary_email" varchar(100),
	"web_address" varchar(100),
	"reg_no" varchar(30),
	"tax_no" varchar(30),
	"fic_no" varchar(30),
	"currency_code" varchar(3),
	"lead_type" varchar(50) NOT NULL,
	"lead_source" varchar(50) NOT NULL,
	"default_tax_code" integer,
	"fleet_no" varchar(30),
	"notes" text,
	"selling_dealer" varchar(100),
	"selling_date" date,
	"role_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"address_type" varchar(20) NOT NULL,
	"address_line1" varchar(100),
	"address_line2" varchar(100),
	"address_line3" varchar(100),
	"city" varchar(50),
	"province_id" integer,
	"area_code" varchar(10),
	"country" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"contact_type" varchar(20) NOT NULL,
	"country_code" varchar(10),
	"contact_number" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"occupation" varchar(50),
	"receive_email" boolean,
	"receive_sms" boolean,
	"receive_post" boolean,
	"receive_telemarketing" boolean,
	"primary_contact" varchar(1),
	"secondary_contact" varchar(1),
	"receive_marketing_all" boolean,
	"receive_marketing_vehicle" boolean,
	"receive_marketing_service" boolean,
	"receive_marketing_parts" boolean,
	"csi_consent_service" boolean DEFAULT false,
	"csi_consent_vehicles" boolean DEFAULT false,
	"csi_consent_surveys" boolean DEFAULT false,
	"csi_consent_bulk_sms" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"dealer_id" uuid,
	"oem_model" varchar(100),
	"brand" varchar(100) NOT NULL,
	"model" varchar(100) NOT NULL,
	"model_variant" varchar(150),
	"manufacturing_year" integer NOT NULL,
	"vin" varchar(50) NOT NULL,
	"engine_number" varchar(100),
	"registration_number" varchar(50),
	"ext_colour" varchar(100),
	"int_colour" varchar(100),
	"fuel_type" varchar(50),
	"transmission_type" varchar(50),
	"odometer_last" integer NOT NULL,
	"delivery_date" date,
	"veh_stock_no" varchar(100),
	"veh_global_stock_no" varchar(100),
	"factory_job_no" varchar(100),
	"series_description" varchar(150),
	"model_description" varchar(150),
	"registration_date" date,
	"default_tax_code" varchar(50),
	"purchase_tran_code" varchar(50),
	"date_stocked" date,
	"condition" varchar(100),
	"vehicle_location" varchar(150),
	"nsc_number" varchar(100),
	"microdot_number" varchar(100),
	"mm_code" varchar(100),
	"passenger_commercial" char(1),
	"body_type" varchar(100),
	"engine_capacity" integer,
	"total_invoice_cost_excl" numeric(12, 2),
	"less_advertising_exp" numeric(12, 2),
	"less_holdback" numeric(12, 2),
	"estimated_reconditioning" numeric(12, 2),
	"retail_price" numeric(12, 2),
	"total_msrp" numeric(12, 2),
	"addendum_amount" numeric(12, 2),
	"current_price" numeric(12, 2),
	"depreciation_perc" numeric(5, 2),
	"book_retail_amount" numeric(12, 2),
	"book_trade_amount" numeric(12, 2),
	"available_for_resale" boolean DEFAULT false,
	"certification_no" varchar(100),
	"certified_pre_owned" boolean DEFAULT false,
	"days_stocked_at_location" integer,
	"days_stocked_branch" integer,
	"days_stocked_category_changed" integer,
	"days_stocked_group" integer,
	"dealer_certified" boolean DEFAULT false,
	"delivery_kilometers" integer,
	"driver_contact_no" varchar(50),
	"driver_name" varchar(150),
	"fleet_contract_no" varchar(100),
	"fleet_controller" varchar(150),
	"full_service_history" boolean DEFAULT false,
	"imported_vehicle" boolean DEFAULT false,
	"mv_certification_date" date,
	"mv_certification_number" varchar(100),
	"mv_registration_date" date,
	"mv_registration_number" varchar(100),
	"comments" text,
	"previous_owners" integer,
	"rental_contract" varchar(100),
	"rental_start_datetime" timestamp with time zone,
	"rental_end_datetime" timestamp with time zone,
	"rental_item_category" varchar(100),
	"reserved_for" varchar(150),
	"reserved_for_by" varchar(150),
	"telematics_id" varchar(100),
	"telematics_asset_id" varchar(100),
	"telematics_location" varchar(150),
	"telematics_service" varchar(150),
	"warranty_acceptance_cert" boolean DEFAULT false,
	"warranty_acceptance_cert_date" date,
	"warranty_active" boolean DEFAULT false,
	"warranty_number" varchar(100),
	"warranty_start_date" date,
	"key_number" varchar(100),
	"key_number2" varchar(100),
	"battery_voltage" numeric(6, 2),
	"date_built" date,
	"date_first_sold" date,
	"drive" varchar(100),
	"e_tag_number" varchar(100),
	"gross_vehicle_mass" numeric(10, 2),
	"immobiliser_number" varchar(100),
	"in_service_kilometers" integer,
	"no_of_cylinders" integer,
	"no_of_doors" integer,
	"no_of_passengers" integer,
	"no_of_axles" integer,
	"odo_type" varchar(50),
	"oem_warranty_end" date,
	"province_registered" varchar(100),
	"radio_pin" varchar(100),
	"selling_dealer_code" varchar(100),
	"service_key" varchar(100),
	"trader_id" varchar(100),
	"trader_reference" varchar(100),
	"unladen_weight" numeric(10, 2),
	"vehicle_trim" varchar(150),
	"entry_time" timestamp with time zone,
	"status" varchar(50) DEFAULT 'Entry (Draft)' NOT NULL,
	"priority" varchar(20) DEFAULT 'STANDARD' NOT NULL,
	"service_type" varchar(50) DEFAULT 'GENERAL_SERVICE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_makes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_accessories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"accessory_code" varchar(100) NOT NULL,
	"accessory_name" varchar(200) NOT NULL,
	"accessory_type" varchar(50),
	"quantity" integer DEFAULT 1,
	"unit_price" numeric(12, 2),
	"total_price" numeric(12, 2),
	"is_factory_fitted" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"image_category" varchar(50),
	"image_path" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"check_in_number" varchar(50),
	"odometer_reading" integer NOT NULL,
	"status" "vehicle_check_in_status" DEFAULT 'IN_QUEUE' NOT NULL,
	"check_in_time" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_check_in_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_check_in_id" uuid NOT NULL,
	"photo_type" "vehicle_photo_type" NOT NULL,
	"image_url" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_service_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"service_type" varchar(100) NOT NULL,
	"service_date" date NOT NULL,
	"technician_name" varchar(150),
	"total_cost" numeric(12, 2),
	"duration" varchar(50),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_colours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" varchar(200) NOT NULL,
	"type" varchar(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_check_in_id" uuid NOT NULL,
	"service_type" varchar(50),
	"priority" varchar(20) DEFAULT 'STANDARD' NOT NULL,
	"status" "qc_inspection_status" DEFAULT 'PENDING' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"brake_performance" varchar(20),
	"brake_noise" varchar(20),
	"brake_vibration" varchar(20),
	"overall_status" "qc_overall_status",
	"override_justification" text,
	"final_remarks" text,
	"signature_url" varchar(500),
	"time_in" timestamp with time zone,
	"time_out" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_confirmation_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"major_component" varchar(200),
	"item_number" varchar(100),
	"comment" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_workshop_rework" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"major_component" varchar(200),
	"technician" varchar(200),
	"item_number" varchar(100),
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"category" "qc_category" NOT NULL,
	"sub_category" varchar(100),
	"item_code" varchar(50) NOT NULL,
	"item_label" varchar(200) NOT NULL,
	"sort_order" integer NOT NULL,
	"result" "qc_item_result",
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_inspection_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_item_id" uuid NOT NULL,
	"image_url" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(50) NOT NULL,
	"sub_category" varchar(100),
	"item_code" varchar(50) NOT NULL,
	"item_label" varchar(200) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"inspection_id" uuid,
	"vehicle_check_in_id" uuid,
	"status" "job_card_status" DEFAULT 'DRAFT' NOT NULL,
	"service_type" varchar(100),
	"service_category" varchar(100),
	"subtotal" numeric(12, 2) DEFAULT '0',
	"tax_label" varchar(20) DEFAULT 'GST' NOT NULL,
	"tax_percentage" numeric(5, 2) DEFAULT '18',
	"tax_amount" numeric(12, 2) DEFAULT '0',
	"total_estimate" numeric(12, 2) DEFAULT '0',
	"currency_code" varchar(3) DEFAULT 'USD' NOT NULL,
	"approval_token" varchar(64),
	"shared_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"modification_note" text,
	"assigned_technician_id" uuid,
	"estimated_hours" numeric(6, 2),
	"priority" "job_card_priority",
	"assigned_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_cards_approval_token_unique" UNIQUE("approval_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_card_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_card_id" uuid NOT NULL,
	"job_description" varchar(500) NOT NULL,
	"parts_required" varchar(500),
	"service_type" varchar(100),
	"service_category" varchar(100),
	"parts_cost" numeric(12, 2) DEFAULT '0',
	"labour_cost" numeric(12, 2) DEFAULT '0',
	"quantity" integer DEFAULT 1 NOT NULL,
	"line_total" numeric(12, 2) DEFAULT '0',
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_approved_by_customer" boolean,
	"assigned_technician_id" uuid,
	"estimated_hours" numeric(6, 2),
	"priority" "job_card_priority",
	"assigned_at" timestamp with time zone,
	"assigned_by" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"completion_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_card_item_time_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_card_item_id" uuid NOT NULL,
	"technician_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_card_id" uuid NOT NULL,
	"job_card_item_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"part_name" varchar(200) NOT NULL,
	"part_number" varchar(200),
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" "part_request_status" DEFAULT 'pending' NOT NULL,
	"expected_time" varchar(100),
	"updated_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parts_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_code" varchar(50) NOT NULL,
	"part_name" varchar(200) NOT NULL,
	"default_price" numeric(12, 2) DEFAULT '0',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provinces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"emoji" varchar(10) DEFAULT '🔧' NOT NULL,
	"category" varchar(30) DEFAULT 'appointment' NOT NULL,
	"estimated_duration_minutes" integer DEFAULT 150 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ro_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_advisors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advisor_code" varchar(50) NOT NULL,
	"name" varchar(150) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_service_type_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"service_type_id" uuid NOT NULL,
	"service_category_id" uuid,
	"part_code" varchar(50) DEFAULT '' NOT NULL,
	"part_name" varchar(200) NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_ref" varchar(20) NOT NULL,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"service_advisor_id" uuid,
	"service_type" varchar(50) NOT NULL,
	"complaints" jsonb NOT NULL,
	"estimated_duration_minutes" integer DEFAULT 150 NOT NULL,
	"appointment_date" date NOT NULL,
	"appointment_time" varchar(5) NOT NULL,
	"pickup_required" boolean DEFAULT false NOT NULL,
	"pickup_address" text,
	"internal_notes" text,
	"status" "appointment_status" DEFAULT 'BOOKED' NOT NULL,
	"check_in_id" uuid,
	"odometer_reading" integer,
	"whatsapp_sent" boolean DEFAULT false NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"original_date" date,
	"original_time" varchar(5),
	"last_rescheduled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointment_reschedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"previous_date" date NOT NULL,
	"previous_time" varchar(5) NOT NULL,
	"new_date" date NOT NULL,
	"new_time" varchar(5) NOT NULL,
	"reason" text,
	"rescheduled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slot_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"time" varchar(5) NOT NULL,
	"capacity" integer DEFAULT 3 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permissions" ADD CONSTRAINT "permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customers" ADD CONSTRAINT "customers_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_make_id_vehicle_makes_id_fk" FOREIGN KEY ("make_id") REFERENCES "public"."vehicle_makes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_accessories" ADD CONSTRAINT "vehicle_accessories_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_check_ins" ADD CONSTRAINT "vehicle_check_ins_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_check_ins" ADD CONSTRAINT "vehicle_check_ins_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_check_ins" ADD CONSTRAINT "vehicle_check_ins_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_check_in_photos" ADD CONSTRAINT "vehicle_check_in_photos_vehicle_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("vehicle_check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_service_history" ADD CONSTRAINT "vehicle_service_history_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_vehicle_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("vehicle_check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_confirmation_components" ADD CONSTRAINT "qc_confirmation_components_inspection_id_qc_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."qc_inspections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_workshop_rework" ADD CONSTRAINT "qc_workshop_rework_inspection_id_qc_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."qc_inspections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_inspection_items" ADD CONSTRAINT "qc_inspection_items_inspection_id_qc_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."qc_inspections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qc_inspection_photos" ADD CONSTRAINT "qc_inspection_photos_inspection_item_id_qc_inspection_items_id_fk" FOREIGN KEY ("inspection_item_id") REFERENCES "public"."qc_inspection_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_inspection_id_qc_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."qc_inspections"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_vehicle_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("vehicle_check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_assigned_technician_id_users_id_fk" FOREIGN KEY ("assigned_technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_items" ADD CONSTRAINT "job_card_items_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_items" ADD CONSTRAINT "job_card_items_assigned_technician_id_users_id_fk" FOREIGN KEY ("assigned_technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_items" ADD CONSTRAINT "job_card_items_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_items" ADD CONSTRAINT "job_card_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_item_time_logs" ADD CONSTRAINT "job_card_item_time_logs_job_card_item_id_job_card_items_id_fk" FOREIGN KEY ("job_card_item_id") REFERENCES "public"."job_card_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_card_item_time_logs" ADD CONSTRAINT "job_card_item_time_logs_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_job_card_item_id_job_card_items_id_fk" FOREIGN KEY ("job_card_item_id") REFERENCES "public"."job_card_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_service_type_assignments" ADD CONSTRAINT "model_service_type_assignments_make_id_vehicle_makes_id_fk" FOREIGN KEY ("make_id") REFERENCES "public"."vehicle_makes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_service_type_assignments" ADD CONSTRAINT "model_service_type_assignments_model_id_vehicle_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_service_type_assignments" ADD CONSTRAINT "model_service_type_assignments_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_service_type_assignments" ADD CONSTRAINT "model_service_type_assignments_service_category_id_service_types_id_fk" FOREIGN KEY ("service_category_id") REFERENCES "public"."service_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_service_type_assignments" ADD CONSTRAINT "model_service_type_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_advisor_id_users_id_fk" FOREIGN KEY ("service_advisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_check_in_id_vehicle_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."vehicle_check_ins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_reschedules" ADD CONSTRAINT "appointment_reschedules_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointment_reschedules" ADD CONSTRAINT "appointment_reschedules_rescheduled_by_users_id_fk" FOREIGN KEY ("rescheduled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_roles_slug" ON "roles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_role_id" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_sessions_jti" ON "user_sessions" USING btree ("jti");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_sessions_user_id" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_permissions_role_id" ON "permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_permissions_role_resource_action" ON "permissions" USING btree ("role_id","resource","action");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customers_crm_and_sequence" ON "customers" USING btree ("crm_reference_no","cust_sequence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customers_active" ON "customers" USING btree ("active_customer");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_addresses_customer_id" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_contacts_customer_id" ON "customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_contact_type_per_customer" ON "customer_contacts" USING btree ("customer_id","contact_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_customer_profiles_customer_id" ON "customer_profiles" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicles_vin_active" ON "vehicles" USING btree ("vin") WHERE "vehicles"."status" <> 'Archived';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicles_registration_active" ON "vehicles" USING btree ("registration_number") WHERE "vehicles"."status" <> 'Archived';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicles_stock_no" ON "vehicles" USING btree ("veh_stock_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicles_registration" ON "vehicles" USING btree ("registration_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicles_customer_id" ON "vehicles" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicles_dealer_id" ON "vehicles" USING btree ("dealer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicle_makes_name" ON "vehicle_makes" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_models_make_id" ON "vehicle_models" USING btree ("make_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicle_model_per_make" ON "vehicle_models" USING btree ("make_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_accessories_vehicle_id" ON "vehicle_accessories" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicle_accessory" ON "vehicle_accessories" USING btree ("vehicle_id","accessory_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_check_ins_vehicle_id" ON "vehicle_check_ins" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_check_ins_status" ON "vehicle_check_ins" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_check_ins_check_in_time" ON "vehicle_check_ins" USING btree ("check_in_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_check_in_photos_check_in_id" ON "vehicle_check_in_photos" USING btree ("vehicle_check_in_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_service_history_vehicle_id" ON "vehicle_service_history" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vehicle_service_history_date" ON "vehicle_service_history" USING btree ("service_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicle_conditions_code" ON "vehicle_conditions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicle_colours_code_type" ON "vehicle_colours" USING btree ("code","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_inspections_vehicle_check_in_id" ON "qc_inspections" USING btree ("vehicle_check_in_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_inspections_status" ON "qc_inspections" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_confirm_comp_inspection" ON "qc_confirmation_components" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_workshop_rework_inspection" ON "qc_workshop_rework" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_inspection_items_inspection_id" ON "qc_inspection_items" USING btree ("inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_qc_inspection_item" ON "qc_inspection_items" USING btree ("inspection_id","item_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_qc_inspection_photos_item_id" ON "qc_inspection_photos" USING btree ("inspection_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_qc_checklist_templates_code" ON "qc_checklist_templates" USING btree ("item_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_cards_vehicle_id" ON "job_cards" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_cards_status" ON "job_cards" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_cards_inspection_id" ON "job_cards" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_cards_vehicle_check_in_id" ON "job_cards" USING btree ("vehicle_check_in_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_cards_approval_token" ON "job_cards" USING btree ("approval_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_job_card_items_job_card_id" ON "job_card_items" USING btree ("job_card_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jci_time_logs_item_id" ON "job_card_item_time_logs" USING btree ("job_card_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jci_time_logs_technician_id" ON "job_card_item_time_logs" USING btree ("technician_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_part_requests_job_card_id" ON "part_requests" USING btree ("job_card_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_part_requests_vehicle_id" ON "part_requests" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_part_requests_status" ON "part_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_parts_master_code" ON "parts_master" USING btree ("part_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_provinces_code" ON "provinces" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_types_code" ON "service_types" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ro_statuses_code" ON "ro_statuses" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_advisors_code" ON "service_advisors" USING btree ("advisor_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msta_make_id" ON "model_service_type_assignments" USING btree ("make_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msta_model_id" ON "model_service_type_assignments" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_msta_service_type_id" ON "model_service_type_assignments" USING btree ("service_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_appointments_booking_ref" ON "appointments" USING btree ("booking_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_appointments_customer_id" ON "appointments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_appointments_vehicle_id" ON "appointments" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_appointments_date" ON "appointments" USING btree ("appointment_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_appointments_status" ON "appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_appointments_date_time" ON "appointments" USING btree ("appointment_date","appointment_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_appointment_reschedules_appointment_id" ON "appointment_reschedules" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_complaints_name" ON "complaints" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_slot_configurations_time" ON "slot_configurations" USING btree ("time");