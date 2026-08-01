CREATE TABLE "template_ai_mapping_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"proposal_id" varchar(120) NOT NULL,
	"action" varchar(32) NOT NULL,
	"actor_id" uuid,
	"before_binding_digest" varchar(128) NOT NULL,
	"after_binding_digest" varchar(128),
	"result_revision" integer,
	"binding_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_html_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"source_storage_key" varchar(500) NOT NULL,
	"source_digest" varchar(128) NOT NULL,
	"source_size" integer NOT NULL,
	"sanitized_html" text NOT NULL,
	"sanitized_digest" varchar(128) NOT NULL,
	"node_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asset_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"security_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compiler_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_html_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid,
	"mode" varchar(20) NOT NULL,
	"status" varchar(32) DEFAULT 'awaiting_upload' NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"source_storage_key" varchar(500) NOT NULL,
	"source_digest" varchar(128),
	"source_size" integer,
	"staged_html_key" varchar(500),
	"sanitized_html" text,
	"sanitized_digest" varchar(128),
	"node_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asset_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"security_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"committed_template_id" uuid,
	"committed_document_id" uuid,
	"error_code" varchar(80),
	"error_message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "output_json" jsonb;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "document_digest" varchar(128);--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "binding_digest" varchar(128);--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "base_revision" integer;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "catalog_version" integer;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "sample_digest" varchar(128);--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "prompt_version" integer;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "error_code" varchar(80);--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "template_ai_mapping_actions" ADD CONSTRAINT "template_ai_mapping_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_ai_mapping_actions" ADD CONSTRAINT "template_ai_mapping_actions_template_id_conference_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."conference_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_ai_mapping_actions" ADD CONSTRAINT "template_ai_mapping_actions_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_ai_mapping_actions" ADD CONSTRAINT "template_ai_mapping_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_html_documents" ADD CONSTRAINT "template_html_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_html_documents" ADD CONSTRAINT "template_html_documents_template_id_conference_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."conference_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_html_documents" ADD CONSTRAINT "template_html_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_html_imports" ADD CONSTRAINT "template_html_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_html_imports" ADD CONSTRAINT "template_html_imports_template_id_conference_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."conference_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_html_imports" ADD CONSTRAINT "template_html_imports_committed_template_id_conference_templates_id_fk" FOREIGN KEY ("committed_template_id") REFERENCES "public"."conference_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_html_imports" ADD CONSTRAINT "template_html_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_ai_mapping_actions_run_proposal_action_unique" ON "template_ai_mapping_actions" USING btree ("run_id","proposal_id","action");--> statement-breakpoint
CREATE INDEX "template_ai_mapping_actions_template_time_idx" ON "template_ai_mapping_actions" USING btree ("template_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "template_html_documents_org_digest_unique" ON "template_html_documents" USING btree ("organization_id","sanitized_digest");--> statement-breakpoint
CREATE INDEX "template_html_documents_template_idx" ON "template_html_documents" USING btree ("template_id","created_at");--> statement-breakpoint
CREATE INDEX "template_html_imports_org_status_idx" ON "template_html_imports" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "template_html_imports_expiry_idx" ON "template_html_imports" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_template_id_conference_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."conference_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_template_time_idx" ON "ai_runs" USING btree ("template_id","created_at");