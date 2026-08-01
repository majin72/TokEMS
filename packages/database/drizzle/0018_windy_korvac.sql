SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "customer_users_org_effective_activity_idx" ON "customer_users" USING btree ("organization_id",coalesce("last_registration_at", "created_at"),"id");
