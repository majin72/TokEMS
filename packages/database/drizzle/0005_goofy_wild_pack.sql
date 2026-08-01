CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(60) NOT NULL,
	"grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "settings" SET DEFAULT '{"locale":"zh-CN","registration":{"paymentMode":"ticketed","currency":"CNY","registrationOpen":true}}'::jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "settings" SET DEFAULT '{"brandName":"大会管理中心","defaultTimezone":"Asia/Shanghai","defaultCurrency":"CNY","defaultBlueprintId":null}'::jsonb;--> statement-breakpoint
UPDATE "events"
SET "settings" =
  '{"locale":"zh-CN"}'::jsonb
  || "settings"
  || jsonb_build_object(
    'registration',
    '{"paymentMode":"ticketed","currency":"CNY","registrationOpen":true}'::jsonb
      || COALESCE("settings"->'registration', '{}'::jsonb)
  );--> statement-breakpoint
UPDATE "organizations"
SET "settings" =
  '{"brandName":"大会管理中心","defaultTimezone":"Asia/Shanghai","defaultCurrency":"CNY","defaultBlueprintId":null}'::jsonb
  || "settings";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "status" "membership_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_token_hash_unique" ON "organization_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "organization_invitations_org_status_idx" ON "organization_invitations" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "organization_invitations_email_idx" ON "organization_invitations" USING btree ("email");
