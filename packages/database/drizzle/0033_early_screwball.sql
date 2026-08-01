ALTER TABLE "outbox_events" ADD COLUMN "dispatch_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dispatch_lease_expires_at" timestamp with time zone;