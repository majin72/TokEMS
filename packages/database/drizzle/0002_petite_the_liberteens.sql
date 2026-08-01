ALTER TABLE "checkin_sync_batches" ADD COLUMN "status" varchar(24) DEFAULT 'processing' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin_sync_batches" ADD COLUMN "results" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "checkin_sync_batches" ADD COLUMN "completed_at" timestamp with time zone;