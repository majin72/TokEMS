CREATE TABLE "order_access_link_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"combination_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_export_jobs" ADD COLUMN "storage_key" varchar(500);--> statement-breakpoint
ALTER TABLE "invoice_export_jobs" ADD COLUMN "content_digest" varchar(128);--> statement-breakpoint
ALTER TABLE "invoice_export_jobs" ADD COLUMN "size" integer;--> statement-breakpoint
CREATE INDEX "order_access_link_attempts_hash_time_idx" ON "order_access_link_attempts" USING btree ("combination_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_documents_one_active_per_request_unique" ON "invoice_documents" USING btree ("invoice_request_id") WHERE "invoice_documents"."voided_at" is null;