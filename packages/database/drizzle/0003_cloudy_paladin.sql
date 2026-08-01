ALTER TABLE "waitlist_entries" ADD COLUMN "offer_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "offer_token_last4" varchar(8);--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_offer_token_hash_unique" ON "waitlist_entries" USING btree ("offer_token_hash");