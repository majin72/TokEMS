-- Enum ADD VALUE must commit before the new labels can be referenced
-- (e.g. in partial indexes). Keep this file transaction-isolated from 0036.
ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'preparing';
--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'query_pending';
--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'close_pending';
--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'closed';
--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'unknown';
