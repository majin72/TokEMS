SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "settings" SET DEFAULT '{"locale":"zh-CN","registration":{"paymentMode":"ticketed","currency":"CNY","registrationOpen":true,"accountMode":"mobile_otp_required"}}'::jsonb;--> statement-breakpoint
CREATE INDEX "customer_auth_challenges_global_mobile_time_idx" ON "customer_auth_challenges" USING btree ("mobile_e164","created_at");--> statement-breakpoint
CREATE INDEX "customer_sessions_expiry_idx" ON "customer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "customer_sessions_revoked_idx" ON "customer_sessions" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "invoice_requests_registration_time_idx" ON "invoice_requests" USING btree ("registration_id","requested_at","id");
