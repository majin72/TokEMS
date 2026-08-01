ALTER TABLE "event_id_allocators" DROP CONSTRAINT "event_id_allocators_last_id_range";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_id_range";--> statement-breakpoint
ALTER TABLE "ai_runs" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "checkin_devices" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "checkin_lists" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "checkin_records" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "checkin_sync_batches" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "event_id_allocators" ALTER COLUMN "last_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "event_releases" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "event_template_bindings" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "event_template_overrides" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "id" SET DEFAULT allocate_event_id();--> statement-breakpoint
ALTER TABLE "inventory_reservations" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "invoice_requests" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "outbox_events" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "registration_forms" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "registrations" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "speakers" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "ticket_quotas" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "ticket_types" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ALTER COLUMN "event_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "event_id_allocators" ADD CONSTRAINT "event_id_allocators_last_id_range" CHECK ("event_id_allocators"."last_id" between 100 and 2147483647);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_id_range" CHECK ("events"."id" between 101 and 2147483647);