SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE INDEX "customer_profiles_nickname_trgm_idx" ON "customer_profiles" USING gin ("nickname" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customer_profiles_real_name_trgm_idx" ON "customer_profiles" USING gin ("real_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customer_profiles_email_trgm_idx" ON "customer_profiles" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customer_profiles_company_trgm_idx" ON "customer_profiles" USING gin ("company" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customer_users_mobile_trgm_idx" ON "customer_users" USING gin ("mobile_e164" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notification_deliveries_channel_subject_time_idx" ON "notification_deliveries" USING btree ("channel","subject","created_at");--> statement-breakpoint
CREATE INDEX "outbox_type_published_time_idx" ON "outbox_events" USING btree ("event_type","published_at","occurred_at");
