ALTER TABLE "customer_media_assets" DROP CONSTRAINT "customer_media_assets_kind_check";--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD COLUMN "adjustment_amount" integer;--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD COLUMN "adjustment_proposed_by" uuid;--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD COLUMN "adjustment_proposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_payout_batches" ADD COLUMN "approval_reason" text;--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD COLUMN "scene_id" varchar(16) DEFAULT '1005' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD COLUMN "job_type" varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD COLUMN "remuneration_description" varchar(80) NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD COLUMN "amount" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD COLUMN "recipient_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_payout_requests" ADD COLUMN "recipient_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD CONSTRAINT "partner_commission_inquiries_adjustment_proposed_by_users_id_fk" FOREIGN KEY ("adjustment_proposed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_media_assets" ADD CONSTRAINT "customer_media_assets_kind_check" CHECK ("customer_media_assets"."kind" in ('avatar', 'partner_avatar', 'partner_gallery'));--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD CONSTRAINT "partner_commission_inquiries_adjustment_check" CHECK ("partner_commission_inquiries"."adjustment_amount" is null or "partner_commission_inquiries"."adjustment_amount" <> 0);--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD CONSTRAINT "partner_payout_executions_amount_check" CHECK ("partner_payout_executions"."amount" > 0);