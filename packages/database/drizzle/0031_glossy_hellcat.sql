ALTER TABLE "conference_template_drafts" ALTER COLUMN "schema_version" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "conference_template_versions" ALTER COLUMN "schema_version" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "idempotency_keys"
SET "lease_expires_at" = now() + interval '2 minutes'
WHERE "lease_expires_at" IS NULL
  AND "response_body" @> '{"__tokemsIdempotencyPending":true}'::jsonb;--> statement-breakpoint
ALTER TABLE "template_asset_upload_reservations" ADD COLUMN "cleanup_requested_at" timestamp with time zone;
