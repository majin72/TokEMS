DROP INDEX IF EXISTS "registrations_event_mobile_active_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "registrations_event_customer_active_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registrations_event_mobile_idx" ON "registrations" USING btree ("event_id","attendee_mobile_e164") WHERE "registrations"."attendee_mobile_e164" <> '';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registrations_event_customer_idx" ON "registrations" USING btree ("event_id","customer_user_id") WHERE "registrations"."customer_user_id" is not null;
