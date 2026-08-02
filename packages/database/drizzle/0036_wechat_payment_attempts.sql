CREATE TYPE "public"."payment_channel" AS ENUM('native', 'jsapi', 'h5', 'free', 'mock');
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "channel" "payment_channel";
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "out_trade_no" varchar(32);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "wechat_trade_state" varchar(32);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "credential_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "prepared_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "prepay_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "closed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "last_queried_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "query_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "payments"
SET
  "channel" = 'native',
  "out_trade_no" = COALESCE(
    NULLIF("payload"->>'outTradeNo', ''),
    (
      SELECT "orders"."order_no"
      FROM "orders"
      WHERE "orders"."id" = "payments"."order_id"
    )
  ),
  "prepared_at" = COALESCE(
    CASE
      WHEN ("payload"->>'preparedAt') ~ '^\d{4}-' THEN ("payload"->>'preparedAt')::timestamptz
      ELSE NULL
    END,
    "created_at"
  )
WHERE "provider" = 'wechatpay';
--> statement-breakpoint
UPDATE "payments"
SET "channel" = 'free'
WHERE "provider" = 'free' AND "channel" IS NULL;
--> statement-breakpoint
UPDATE "payments"
SET "channel" = 'mock'
WHERE "provider" LIKE 'mock%' AND "channel" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_out_trade_no_unique" ON "payments" USING btree ("out_trade_no");
--> statement-breakpoint
CREATE INDEX "payments_order_status_channel_idx" ON "payments" USING btree ("order_id","status","channel");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_active_attempt_unique" ON "payments" USING btree ("order_id") WHERE "status" in ('preparing', 'pending', 'processing', 'query_pending', 'close_pending', 'unknown');
--> statement-breakpoint
CREATE TABLE "payment_notification_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"notification_id" varchar(128) NOT NULL,
	"out_trade_no" varchar(32) NOT NULL,
	"payment_id" uuid,
	"order_id" uuid,
	"event_type" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'received' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_notification_inbox" ADD CONSTRAINT "payment_notification_inbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_notification_inbox" ADD CONSTRAINT "payment_notification_inbox_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_notification_inbox" ADD CONSTRAINT "payment_notification_inbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_notification_inbox_notification_unique" ON "payment_notification_inbox" USING btree ("notification_id");
--> statement-breakpoint
CREATE INDEX "payment_notification_inbox_status_idx" ON "payment_notification_inbox" USING btree ("status","updated_at");
--> statement-breakpoint
CREATE INDEX "payment_notification_inbox_out_trade_no_idx" ON "payment_notification_inbox" USING btree ("out_trade_no");
