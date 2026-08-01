CREATE TABLE "invoice_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"filename" varchar(240),
	"csv_content" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_export_jobs" ADD CONSTRAINT "invoice_export_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_export_jobs" ADD CONSTRAINT "invoice_export_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_export_jobs_org_created_idx" ON "invoice_export_jobs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_export_jobs_status_idx" ON "invoice_export_jobs" USING btree ("status","created_at");