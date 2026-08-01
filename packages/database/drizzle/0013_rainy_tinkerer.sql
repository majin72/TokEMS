SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '15min';--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'blocked', 'closed');--> statement-breakpoint
CREATE TABLE "customer_auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mobile_e164" varchar(24) NOT NULL,
	"code_digest" varchar(128) NOT NULL,
	"request_ip_hash" varchar(64) NOT NULL,
	"delivery_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"consent_type" varchar(32) NOT NULL,
	"version" varchar(40) NOT NULL,
	"source" varchar(32) DEFAULT 'otp_login' NOT NULL,
	"request_ip_hash" varchar(64) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"customer_user_id" uuid PRIMARY KEY NOT NULL,
	"nickname" varchar(80),
	"real_name" varchar(120),
	"email" varchar(255),
	"company" varchar(160),
	"title" varchar(100),
	"city" varchar(80),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_agent_hash" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mobile_e164" varchar(24) NOT NULL,
	"status" "customer_status" DEFAULT 'active' NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_registration_at" timestamp with time zone,
	"internal_note" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"status" varchar(32) DEFAULT 'unconfigured' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_credentials" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_error" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "waitlist_event_ticket_email_unique";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "settings" SET DEFAULT '{"locale":"zh-CN","registration":{"paymentMode":"ticketed","currency":"CNY","registrationOpen":true,"accountMode":"mobile_otp_required"}}'::jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "settings" SET DEFAULT '{"brandName":"大会管理中心","defaultTimezone":"Asia/Shanghai","defaultCurrency":"CNY","defaultBlueprintId":null,"defaultTemplateId":null,"customerAccounts":{"defaultAccountMode":"mobile_otp_required","termsUrl":"","termsVersion":"","privacyUrl":"","privacyVersion":""},"website":{"siteName":"大会报名中心","seoTitle":"大会报名中心","seoDescription":"","faviconUrl":"","footerText":"","icpNumber":"","supportEmail":""},"analytics":{"enabled":false,"provider":"baidu","trackingId":"","scriptUrl":"","siteId":""}}'::jsonb;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ALTER COLUMN "email" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_type" varchar(24) DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "customer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "attendee_mobile_e164" varchar(24) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "attendee_email_normalized" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "customer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "mobile_e164" varchar(24) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "notification_channel" varchar(16) DEFAULT 'email' NOT NULL;--> statement-breakpoint
UPDATE "registrations"
SET
  "attendee_email_normalized" = lower(trim(coalesce("attendee"->>'email', ''))),
  "attendee_mobile_e164" = CASE
    WHEN regexp_replace(coalesce("attendee"->>'mobile', ''), '\D', '', 'g') ~ '^1[3-9][0-9]{9}$'
      THEN '+86' || regexp_replace("attendee"->>'mobile', '\D', '', 'g')
    WHEN regexp_replace(coalesce("attendee"->>'mobile', ''), '\D', '', 'g') ~ '^861[3-9][0-9]{9}$'
      THEN '+' || regexp_replace("attendee"->>'mobile', '\D', '', 'g')
    ELSE ''
  END;--> statement-breakpoint
ALTER TABLE "customer_auth_challenges" ADD CONSTRAINT "customer_auth_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_users" ADD CONSTRAINT "customer_users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_integrations" ADD CONSTRAINT "organization_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_integrations" ADD CONSTRAINT "organization_integrations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_auth_challenges_mobile_time_idx" ON "customer_auth_challenges" USING btree ("organization_id","mobile_e164","created_at");--> statement-breakpoint
CREATE INDEX "customer_auth_challenges_ip_time_idx" ON "customer_auth_challenges" USING btree ("request_ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "customer_auth_challenges_expiry_idx" ON "customer_auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_consents_user_type_version_unique" ON "customer_consents" USING btree ("customer_user_id","consent_type","version");--> statement-breakpoint
CREATE INDEX "customer_profiles_email_idx" ON "customer_profiles" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_sessions_token_hash_unique" ON "customer_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_sessions_user_expiry_idx" ON "customer_sessions" USING btree ("customer_user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_users_org_mobile_unique" ON "customer_users" USING btree ("organization_id","mobile_e164");--> statement-breakpoint
CREATE INDEX "customer_users_org_status_created_idx" ON "customer_users" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "customer_users_org_last_registration_idx" ON "customer_users" USING btree ("organization_id","last_registration_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_integrations_org_provider_unique" ON "organization_integrations" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "organization_integrations_org_idx" ON "organization_integrations" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_customer_user_id_customer_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."customer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registrations_customer_time_idx" ON "registrations" USING btree ("customer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "registrations_org_mobile_idx" ON "registrations" USING btree ("organization_id","attendee_mobile_e164","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_event_customer_active_unique" ON "registrations" USING btree ("event_id","customer_user_id") WHERE "registrations"."customer_user_id" is not null and "registrations"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_event_ticket_mobile_unique" ON "waitlist_entries" USING btree ("event_id","ticket_type_id","mobile_e164") WHERE "waitlist_entries"."mobile_e164" <> '';--> statement-breakpoint
CREATE INDEX "waitlist_customer_idx" ON "waitlist_entries" USING btree ("customer_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_event_ticket_email_unique" ON "waitlist_entries" USING btree ("event_id","ticket_type_id","email") WHERE "waitlist_entries"."email" <> '';
