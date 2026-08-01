CREATE TYPE "public"."conference_template_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."invoice_request_status" AS ENUM('awaiting_details', 'pending_review', 'issuing', 'issue_failed', 'issued', 'rejected', 'adjustment_required', 'voided', 'cancelled');--> statement-breakpoint
CREATE TABLE "conference_template_drafts" (
	"template_id" uuid PRIMARY KEY NOT NULL,
	"renderer_package_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"content_digest" varchar(128) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conference_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"renderer_package_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"content_digest" varchar(128) NOT NULL,
	"preview_asset_key" varchar(500),
	"change_summary" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conference_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "conference_template_status" DEFAULT 'active' NOT NULL,
	"current_published_version_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_template_bindings" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"template_version_id" uuid NOT NULL,
	"update_policy" varchar(32) DEFAULT 'manual' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "event_template_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"surface" varchar(40) NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"document" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"content_digest" varchar(128) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_request_id" uuid NOT NULL,
	"document_type" varchar(32) DEFAULT 'original' NOT NULL,
	"invoice_number" varchar(80) NOT NULL,
	"invoice_code" varchar(80),
	"external_reference" varchar(160),
	"storage_key" varchar(500) NOT NULL,
	"media_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"content_digest" varchar(128) NOT NULL,
	"replaces_document_id" uuid,
	"issued_by" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_no" varchar(48) NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"buyer_type" varchar(32),
	"title" varchar(200),
	"tax_id" varchar(40),
	"email" varchar(255),
	"mobile" varchar(32),
	"content" varchar(120),
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"net_paid_amount" integer NOT NULL,
	"status" "invoice_request_status" DEFAULT 'awaiting_details' NOT NULL,
	"rejection_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_by" uuid,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_state_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_request_id" uuid NOT NULL,
	"from_status" varchar(40),
	"to_status" varchar(40) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"actor_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"media_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"content_digest" varchar(128) NOT NULL,
	"alt_text" varchar(500) DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "settings" SET DEFAULT '{"brandName":"大会管理中心","defaultTimezone":"Asia/Shanghai","defaultCurrency":"CNY","defaultBlueprintId":null,"defaultTemplateId":null}'::jsonb;--> statement-breakpoint
ALTER TABLE "event_releases" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "conference_template_drafts" ADD CONSTRAINT "conference_template_drafts_template_id_conference_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."conference_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_template_drafts" ADD CONSTRAINT "conference_template_drafts_renderer_package_id_template_packages_id_fk" FOREIGN KEY ("renderer_package_id") REFERENCES "public"."template_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_template_drafts" ADD CONSTRAINT "conference_template_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_template_versions" ADD CONSTRAINT "conference_template_versions_template_id_conference_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."conference_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_template_versions" ADD CONSTRAINT "conference_template_versions_renderer_package_id_template_packages_id_fk" FOREIGN KEY ("renderer_package_id") REFERENCES "public"."template_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_template_versions" ADD CONSTRAINT "conference_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_templates" ADD CONSTRAINT "conference_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_templates" ADD CONSTRAINT "conference_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_templates" ADD CONSTRAINT "conference_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_template_bindings" ADD CONSTRAINT "event_template_bindings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_template_bindings" ADD CONSTRAINT "event_template_bindings_template_version_id_conference_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."conference_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_template_bindings" ADD CONSTRAINT "event_template_bindings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_template_overrides" ADD CONSTRAINT "event_template_overrides_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_template_overrides" ADD CONSTRAINT "event_template_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_invoice_request_id_invoice_requests_id_fk" FOREIGN KEY ("invoice_request_id") REFERENCES "public"."invoice_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_state_logs" ADD CONSTRAINT "invoice_state_logs_invoice_request_id_invoice_requests_id_fk" FOREIGN KEY ("invoice_request_id") REFERENCES "public"."invoice_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_state_logs" ADD CONSTRAINT "invoice_state_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_access_tokens" ADD CONSTRAINT "order_access_tokens_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_assets" ADD CONSTRAINT "template_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_assets" ADD CONSTRAINT "template_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conference_template_drafts_renderer_idx" ON "conference_template_drafts" USING btree ("renderer_package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conference_template_versions_template_version_unique" ON "conference_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "conference_template_versions_template_idx" ON "conference_template_versions" USING btree ("template_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conference_templates_org_code_unique" ON "conference_templates" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "conference_templates_org_status_idx" ON "conference_templates" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "event_template_bindings_version_idx" ON "event_template_bindings" USING btree ("template_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_template_overrides_event_surface_unique" ON "event_template_overrides" USING btree ("event_id","surface");--> statement-breakpoint
CREATE INDEX "event_template_overrides_event_idx" ON "event_template_overrides" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_documents_request_number_unique" ON "invoice_documents" USING btree ("invoice_request_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoice_documents_request_idx" ON "invoice_documents" USING btree ("invoice_request_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_requests_org_no_unique" ON "invoice_requests" USING btree ("organization_id","request_no");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_requests_order_unique" ON "invoice_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoice_requests_org_status_idx" ON "invoice_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "invoice_requests_event_idx" ON "invoice_requests" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_state_logs_request_time_idx" ON "invoice_state_logs" USING btree ("invoice_request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_access_tokens_hash_unique" ON "order_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "order_access_tokens_order_expiry_idx" ON "order_access_tokens" USING btree ("order_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "template_assets_org_digest_unique" ON "template_assets" USING btree ("organization_id","content_digest");--> statement-breakpoint
CREATE INDEX "template_assets_org_created_idx" ON "template_assets" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "event_releases" ADD CONSTRAINT "event_releases_template_version_id_conference_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."conference_template_versions"("id") ON DELETE no action ON UPDATE no action;