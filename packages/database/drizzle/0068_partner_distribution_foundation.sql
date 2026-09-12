CREATE TABLE "event_partner_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"version" integer NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"company" varchar(160) DEFAULT '' NOT NULL,
	"title" varchar(100) DEFAULT '' NOT NULL,
	"industry" varchar(80) DEFAULT '' NOT NULL,
	"business_intro" text DEFAULT '' NOT NULL,
	"business_url" varchar(500) DEFAULT '' NOT NULL,
	"contact_phone" varchar(32) DEFAULT '' NOT NULL,
	"contact_email" varchar(255) DEFAULT '' NOT NULL,
	"wechat_id" varchar(80) DEFAULT '' NOT NULL,
	"avatar_asset_id" uuid,
	"gallery" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_status" varchar(16) DEFAULT 'draft' NOT NULL,
	"visible_fields" jsonb NOT NULL,
	"poster_fields" jsonb NOT NULL,
	"search_indexing_enabled" boolean DEFAULT true NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_partner_profile_versions_status_check" CHECK ("event_partner_profile_versions"."public_status" in ('draft', 'published', 'hidden')),
	CONSTRAINT "event_partner_profile_versions_actor_check" CHECK ("event_partner_profile_versions"."actor_type" in ('customer', 'staff', 'system')),
	CONSTRAINT "event_partner_profile_versions_version_check" CHECK ("event_partner_profile_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "event_partner_program_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"mode" varchar(24) DEFAULT 'fixed' NOT NULL,
	"fixed_rate_bps" integer DEFAULT 1000 NOT NULL,
	"tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eligible_ticket_type_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attribution_days" integer DEFAULT 30 NOT NULL,
	"settlement_delay_days" integer DEFAULT 7 NOT NULL,
	"minimum_payout_amount" integer DEFAULT 1000 NOT NULL,
	"payout_cadence" varchar(16) DEFAULT 'weekly' NOT NULL,
	"terms_title" varchar(160) NOT NULL,
	"terms_content" text NOT NULL,
	"promotion_policy" text NOT NULL,
	"public_directory_enabled" boolean DEFAULT false NOT NULL,
	"homepage_limit" integer DEFAULT 12 NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"effective_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_partner_program_versions_id_scope_unique" UNIQUE("id","organization_id","event_id"),
	CONSTRAINT "event_partner_program_versions_status_check" CHECK ("event_partner_program_versions"."status" in ('draft', 'scheduled', 'active', 'retired')),
	CONSTRAINT "event_partner_program_versions_mode_check" CHECK ("event_partner_program_versions"."mode" in ('fixed', 'order_count_tiered')),
	CONSTRAINT "event_partner_program_versions_numbers_check" CHECK ("event_partner_program_versions"."version" >= 1 and "event_partner_program_versions"."fixed_rate_bps" between 0 and 10000 and "event_partner_program_versions"."attribution_days" between 1 and 365 and "event_partner_program_versions"."settlement_delay_days" between 0 and 365 and "event_partner_program_versions"."minimum_payout_amount" >= 1 and "event_partner_program_versions"."homepage_limit" between 1 and 24),
	CONSTRAINT "event_partner_program_versions_cadence_check" CHECK ("event_partner_program_versions"."payout_cadence" in ('weekly', 'monthly'))
);
--> statement-breakpoint
CREATE TABLE "event_partner_rule_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"program_version_id" uuid NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"terms_content_hash" varchar(64) NOT NULL,
	"request_ip_hash" varchar(64),
	"user_agent_hash" varchar(64),
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"public_slug" varchar(40) NOT NULL,
	"qualification_status" varchar(32) DEFAULT 'pending_confirmation' NOT NULL,
	"attribution_enabled" boolean DEFAULT false NOT NULL,
	"settlement_hold" boolean DEFAULT false NOT NULL,
	"settlement_hold_reason" text DEFAULT '' NOT NULL,
	"current_program_version_id" uuid,
	"accepted_program_version_id" uuid,
	"personal_rate_bps" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"internal_note" text DEFAULT '' NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_partners_id_scope_unique" UNIQUE("id","organization_id","event_id"),
	CONSTRAINT "event_partners_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "event_partners_qualification_check" CHECK ("event_partners"."qualification_status" in ('pending_confirmation', 'active', 'paused', 'closed')),
	CONSTRAINT "event_partners_rate_check" CHECK ("event_partners"."personal_rate_bps" is null or "event_partners"."personal_rate_bps" between 0 and 10000),
	CONSTRAINT "event_partners_version_check" CHECK ("event_partners"."profile_version" >= 1 and "event_partners"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "partner_attribution_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"order_id" uuid NOT NULL,
	"purchase_intent_id" uuid,
	"order_version" integer NOT NULL,
	"partner_id" uuid,
	"referral_link_id" uuid,
	"program_version_id" uuid,
	"decision" varchar(24) NOT NULL,
	"decision_reason" varchar(160) NOT NULL,
	"attribution_expires_at" timestamp with time zone,
	"purchaser_customer_user_id" uuid,
	"personal_rate_bps" integer,
	"order_snapshot" jsonb NOT NULL,
	"created_by" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_attribution_revisions_id_order_unique" UNIQUE("id","order_id"),
	CONSTRAINT "partner_attribution_revisions_decision_check" CHECK ("partner_attribution_revisions"."decision" in ('attributed', 'cleared', 'ineligible', 'expired', 'no_source')),
	CONSTRAINT "partner_attribution_revisions_rate_check" CHECK ("partner_attribution_revisions"."personal_rate_bps" is null or "partner_attribution_revisions"."personal_rate_bps" between 0 and 10000),
	CONSTRAINT "partner_attribution_revisions_version_check" CHECK ("partner_attribution_revisions"."order_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "partner_commission_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"partner_id" uuid NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"type" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"order_reference" varchar(80) NOT NULL,
	"purchased_at" timestamp with time zone,
	"description" text NOT NULL,
	"evidence_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" varchar(32),
	"decision_reason" text,
	"adjustment_ledger_entry_id" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_commission_inquiries_type_check" CHECK ("partner_commission_inquiries"."type" in ('missing_order', 'amount_dispute')),
	CONSTRAINT "partner_commission_inquiries_status_check" CHECK ("partner_commission_inquiries"."status" in ('open', 'under_review', 'resolved', 'rejected')),
	CONSTRAINT "partner_commission_inquiries_version_check" CHECK ("partner_commission_inquiries"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "partner_commission_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"gross_amount" integer NOT NULL,
	"eligible_amount" integer NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"rate_bps" integer NOT NULL,
	"commission_amount" integer NOT NULL,
	"reversed_amount" integer DEFAULT 0 NOT NULL,
	"eligibility" varchar(24) NOT NULL,
	"eligibility_reason" varchar(160) NOT NULL,
	"identity_provisional" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_commission_items_eligibility_check" CHECK ("partner_commission_items"."eligibility" in ('eligible', 'ticket_excluded', 'self_purchase', 'self_attendee', 'refunded')),
	CONSTRAINT "partner_commission_items_money_check" CHECK ("partner_commission_items"."gross_amount" >= 0 and "partner_commission_items"."eligible_amount" >= 0 and "partner_commission_items"."refunded_amount" >= 0 and "partner_commission_items"."rate_bps" between 0 and 10000 and "partner_commission_items"."commission_amount" >= 0 and "partner_commission_items"."reversed_amount" >= 0 and "partner_commission_items"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "partner_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"partner_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"attribution_revision_id" uuid NOT NULL,
	"program_version_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"eligible_amount" integer NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"commission_amount" integer NOT NULL,
	"reversed_amount" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"status" varchar(32) DEFAULT 'provisional' NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_commissions_id_scope_unique" UNIQUE("id","partner_id","organization_id","event_id"),
	CONSTRAINT "partner_commissions_status_check" CHECK ("partner_commissions"."status" in ('provisional', 'pending', 'available', 'reserved', 'paid', 'held', 'reversed', 'partially_reversed', 'recovery_due')),
	CONSTRAINT "partner_commissions_money_check" CHECK ("partner_commissions"."rate_bps" between 0 and 10000 and "partner_commissions"."eligible_amount" >= 0 and "partner_commissions"."refunded_amount" >= 0 and "partner_commissions"."commission_amount" >= 0 and "partner_commissions"."reversed_amount" >= 0),
	CONSTRAINT "partner_commissions_sequence_check" CHECK ("partner_commissions"."sequence" >= 1 and "partner_commissions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "partner_financial_event_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer,
	"source_event_id" uuid,
	"event_type" varchar(80) NOT NULL,
	"event_key" varchar(200) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_financial_event_inbox_status_check" CHECK ("partner_financial_event_inbox"."status" in ('pending', 'processing', 'processed', 'retrying', 'failed')),
	CONSTRAINT "partner_financial_event_inbox_attempts_check" CHECK ("partner_financial_event_inbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "partner_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"partner_id" uuid NOT NULL,
	"commission_id" uuid,
	"commission_item_id" uuid,
	"payout_request_id" uuid,
	"payout_execution_id" uuid,
	"entry_type" varchar(32) NOT NULL,
	"balance_bucket" varchar(24) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"business_key" varchar(200) NOT NULL,
	"source_event_id" uuid,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_type" varchar(16) DEFAULT 'system' NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_ledger_entries_type_check" CHECK ("partner_ledger_entries"."entry_type" in ('commission', 'refund_reversal', 'self_referral_reversal', 'manual_adjustment', 'payout_reservation', 'payout_release', 'tax_withholding', 'payout', 'recovery')),
	CONSTRAINT "partner_ledger_entries_bucket_check" CHECK ("partner_ledger_entries"."balance_bucket" in ('pending', 'available', 'reserved', 'paid', 'recovery_due'))
);
--> statement-breakpoint
CREATE TABLE "partner_payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer,
	"merchant_id" varchar(32),
	"channel" varchar(24) NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"gross_amount" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"net_amount" integer DEFAULT 0 NOT NULL,
	"budget_reserved_amount" integer DEFAULT 0 NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_payout_batches_status_check" CHECK ("partner_payout_batches"."status" in ('draft', 'approved', 'executing', 'completed', 'held', 'cancelled')),
	CONSTRAINT "partner_payout_batches_channel_check" CHECK ("partner_payout_batches"."channel" in ('manual_bank', 'wechat_transfer')),
	CONSTRAINT "partner_payout_batches_money_check" CHECK ("partner_payout_batches"."request_count" >= 0 and "partner_payout_batches"."gross_amount" >= 0 and "partner_payout_batches"."tax_amount" >= 0 and "partner_payout_batches"."net_amount" >= 0 and "partner_payout_batches"."budget_reserved_amount" >= 0 and "partner_payout_batches"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "partner_payout_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"partner_id" uuid NOT NULL,
	"payout_request_id" uuid,
	"payout_execution_id" uuid,
	"kind" varchar(32) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"media_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"content_digest" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_payout_documents_kind_check" CHECK ("partner_payout_documents"."kind" in ('settlement_statement', 'tax_document', 'manual_receipt', 'wechat_receipt')),
	CONSTRAINT "partner_payout_documents_size_check" CHECK ("partner_payout_documents"."size" > 0)
);
--> statement-breakpoint
CREATE TABLE "partner_payout_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"partner_id" uuid NOT NULL,
	"payout_request_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"channel" varchar(24) NOT NULL,
	"status" varchar(32) DEFAULT 'prepared' NOT NULL,
	"merchant_bill_no" varchar(64),
	"provider_transfer_bill_no" varchar(128),
	"integration_revision" integer,
	"credential_version" integer,
	"recipient_snapshot" jsonb NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"response_snapshot" jsonb,
	"confirmation_package" text,
	"confirmation_expires_at" timestamp with time zone,
	"last_queried_at" timestamp with time zone,
	"query_count" integer DEFAULT 0 NOT NULL,
	"external_reference" varchar(160),
	"failure_code" varchar(80),
	"failure_reason" text,
	"submitted_at" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_payout_executions_channel_check" CHECK ("partner_payout_executions"."channel" in ('manual_bank', 'wechat_transfer')),
	CONSTRAINT "partner_payout_executions_counts_check" CHECK ("partner_payout_executions"."query_count" >= 0 and "partner_payout_executions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "partner_payout_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"channel" varchar(24) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"display_name_ciphertext" text NOT NULL,
	"account_reference_ciphertext" text NOT NULL,
	"account_fingerprint" varchar(64) NOT NULL,
	"app_id" varchar(64),
	"open_id_ciphertext" text,
	"verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_payout_recipients_type_check" CHECK ("partner_payout_recipients"."type" in ('individual', 'organization')),
	CONSTRAINT "partner_payout_recipients_channel_check" CHECK ("partner_payout_recipients"."channel" in ('manual_bank', 'wechat_transfer')),
	CONSTRAINT "partner_payout_recipients_status_check" CHECK ("partner_payout_recipients"."status" in ('unbound', 'pending', 'verified', 'disabled')),
	CONSTRAINT "partner_payout_recipients_version_check" CHECK ("partner_payout_recipients"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "partner_payout_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"partner_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"batch_id" uuid,
	"status" varchar(24) DEFAULT 'submitted' NOT NULL,
	"gross_amount" integer NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"net_amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"settlement_snapshot" jsonb NOT NULL,
	"user_confirmed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_payout_requests_id_scope_unique" UNIQUE("id","partner_id","organization_id","event_id"),
	CONSTRAINT "partner_payout_requests_status_check" CHECK ("partner_payout_requests"."status" in ('submitted', 'under_review', 'approved', 'batched', 'executing', 'succeeded', 'rejected', 'cancelled', 'failed', 'unknown')),
	CONSTRAINT "partner_payout_requests_money_check" CHECK ("partner_payout_requests"."gross_amount" > 0 and "partner_payout_requests"."tax_amount" >= 0 and "partner_payout_requests"."net_amount" >= 0 and "partner_payout_requests"."net_amount" + "partner_payout_requests"."tax_amount" = "partner_payout_requests"."gross_amount" and "partner_payout_requests"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "partner_reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer,
	"batch_id" uuid,
	"kind" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'running' NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"checked_count" integer DEFAULT 0 NOT NULL,
	"difference_count" integer DEFAULT 0 NOT NULL,
	"difference_amount" integer DEFAULT 0 NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_by" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_reconciliation_runs_kind_check" CHECK ("partner_reconciliation_runs"."kind" in ('payments', 'refunds', 'payouts')),
	CONSTRAINT "partner_reconciliation_runs_status_check" CHECK ("partner_reconciliation_runs"."status" in ('running', 'matched', 'difference', 'resolved', 'failed')),
	CONSTRAINT "partner_reconciliation_runs_counts_check" CHECK ("partner_reconciliation_runs"."checked_count" >= 0 and "partner_reconciliation_runs"."difference_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "partner_referral_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"code" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"destination_path" varchar(500) NOT NULL,
	"expires_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_referral_links_status_check" CHECK ("partner_referral_links"."status" in ('active', 'disabled', 'rotated'))
);
--> statement-breakpoint
CREATE TABLE "partner_referral_visit_days" (
	"organization_id" uuid NOT NULL,
	"event_id" integer NOT NULL,
	"partner_id" uuid NOT NULL,
	"referral_link_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"visits" bigint DEFAULT 0 NOT NULL,
	"unique_visits" bigint DEFAULT 0 NOT NULL,
	"timezone_snapshot" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_referral_visit_days_referral_link_id_local_date_pk" PRIMARY KEY("referral_link_id","local_date"),
	CONSTRAINT "partner_referral_visit_days_counts_check" CHECK ("partner_referral_visit_days"."visits" >= 0 and "partner_referral_visit_days"."unique_visits" >= 0 and "partner_referral_visit_days"."unique_visits" <= "partner_referral_visit_days"."visits")
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "partner_attribution_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "event_partner_profile_versions" ADD CONSTRAINT "event_partner_profile_versions_avatar_asset_id_customer_media_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "public"."customer_media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partner_profile_versions" ADD CONSTRAINT "event_partner_profile_versions_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partner_program_versions" ADD CONSTRAINT "event_partner_program_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partner_program_versions" ADD CONSTRAINT "event_partner_program_versions_event_scope_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partner_rule_acceptances" ADD CONSTRAINT "event_partner_rule_acceptances_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partner_rule_acceptances" ADD CONSTRAINT "event_partner_rule_acceptances_program_scope_fk" FOREIGN KEY ("program_version_id","organization_id","event_id") REFERENCES "public"."event_partner_program_versions"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partner_rule_acceptances" ADD CONSTRAINT "event_partner_rule_acceptances_customer_scope_fk" FOREIGN KEY ("customer_user_id","organization_id") REFERENCES "public"."customer_users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partners" ADD CONSTRAINT "event_partners_event_scope_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partners" ADD CONSTRAINT "event_partners_customer_scope_fk" FOREIGN KEY ("customer_user_id","organization_id") REFERENCES "public"."customer_users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partners" ADD CONSTRAINT "event_partners_current_program_scope_fk" FOREIGN KEY ("current_program_version_id","organization_id","event_id") REFERENCES "public"."event_partner_program_versions"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_partners" ADD CONSTRAINT "event_partners_accepted_program_scope_fk" FOREIGN KEY ("accepted_program_version_id","organization_id","event_id") REFERENCES "public"."event_partner_program_versions"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_revisions" ADD CONSTRAINT "partner_attribution_revisions_order_scope_fk" FOREIGN KEY ("order_id","organization_id","event_id") REFERENCES "public"."orders"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_revisions" ADD CONSTRAINT "partner_attribution_revisions_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_revisions" ADD CONSTRAINT "partner_attribution_revisions_referral_link_fk" FOREIGN KEY ("referral_link_id") REFERENCES "public"."partner_referral_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_revisions" ADD CONSTRAINT "partner_attribution_revisions_program_scope_fk" FOREIGN KEY ("program_version_id","organization_id","event_id") REFERENCES "public"."event_partner_program_versions"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_attribution_revisions" ADD CONSTRAINT "partner_attribution_revisions_customer_scope_fk" FOREIGN KEY ("purchaser_customer_user_id","organization_id") REFERENCES "public"."customer_users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD CONSTRAINT "partner_commission_inquiries_adjustment_ledger_entry_id_partner_ledger_entries_id_fk" FOREIGN KEY ("adjustment_ledger_entry_id") REFERENCES "public"."partner_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD CONSTRAINT "partner_commission_inquiries_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD CONSTRAINT "partner_commission_inquiries_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD CONSTRAINT "partner_commission_inquiries_customer_scope_fk" FOREIGN KEY ("customer_user_id","organization_id") REFERENCES "public"."customer_users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission_items" ADD CONSTRAINT "partner_commission_items_commission_scope_fk" FOREIGN KEY ("commission_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_commissions"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission_items" ADD CONSTRAINT "partner_commission_items_order_item_scope_fk" FOREIGN KEY ("order_item_id","order_id","organization_id","event_id") REFERENCES "public"."order_items"("id","order_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_order_scope_fk" FOREIGN KEY ("order_id","organization_id","event_id") REFERENCES "public"."orders"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_payment_scope_fk" FOREIGN KEY ("payment_id","order_id") REFERENCES "public"."payments"("id","order_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commissions" ADD CONSTRAINT "partner_commissions_attribution_scope_fk" FOREIGN KEY ("attribution_revision_id","order_id") REFERENCES "public"."partner_attribution_revisions"("id","order_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_commission_id_partner_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."partner_commissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_commission_item_id_partner_commission_items_id_fk" FOREIGN KEY ("commission_item_id") REFERENCES "public"."partner_commission_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_payout_request_id_partner_payout_requests_id_fk" FOREIGN KEY ("payout_request_id") REFERENCES "public"."partner_payout_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_payout_execution_id_partner_payout_executions_id_fk" FOREIGN KEY ("payout_execution_id") REFERENCES "public"."partner_payout_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_batches" ADD CONSTRAINT "partner_payout_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_batches" ADD CONSTRAINT "partner_payout_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_documents" ADD CONSTRAINT "partner_payout_documents_payout_request_id_partner_payout_requests_id_fk" FOREIGN KEY ("payout_request_id") REFERENCES "public"."partner_payout_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_documents" ADD CONSTRAINT "partner_payout_documents_payout_execution_id_partner_payout_executions_id_fk" FOREIGN KEY ("payout_execution_id") REFERENCES "public"."partner_payout_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_documents" ADD CONSTRAINT "partner_payout_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_documents" ADD CONSTRAINT "partner_payout_documents_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD CONSTRAINT "partner_payout_executions_request_scope_fk" FOREIGN KEY ("payout_request_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_payout_requests"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD CONSTRAINT "partner_payout_executions_batch_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."partner_payout_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_recipients" ADD CONSTRAINT "partner_payout_recipients_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id") REFERENCES "public"."event_partners"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_recipients" ADD CONSTRAINT "partner_payout_recipients_customer_scope_fk" FOREIGN KEY ("customer_user_id","organization_id") REFERENCES "public"."customer_users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_requests" ADD CONSTRAINT "partner_payout_requests_batch_id_partner_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."partner_payout_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_requests" ADD CONSTRAINT "partner_payout_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_requests" ADD CONSTRAINT "partner_payout_requests_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_requests" ADD CONSTRAINT "partner_payout_requests_recipient_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."partner_payout_recipients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_reconciliation_runs" ADD CONSTRAINT "partner_reconciliation_runs_batch_id_partner_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."partner_payout_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_reconciliation_runs" ADD CONSTRAINT "partner_reconciliation_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_reconciliation_runs" ADD CONSTRAINT "partner_reconciliation_runs_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referral_links" ADD CONSTRAINT "partner_referral_links_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referral_visit_days" ADD CONSTRAINT "partner_referral_visit_days_partner_scope_fk" FOREIGN KEY ("partner_id","organization_id","event_id") REFERENCES "public"."event_partners"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referral_visit_days" ADD CONSTRAINT "partner_referral_visit_days_link_fk" FOREIGN KEY ("referral_link_id") REFERENCES "public"."partner_referral_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_partner_profile_versions_scope_unique" ON "event_partner_profile_versions" USING btree ("partner_id","version");--> statement-breakpoint
CREATE INDEX "event_partner_profile_versions_public_idx" ON "event_partner_profile_versions" USING btree ("organization_id","event_id","public_status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_partner_program_versions_scope_unique" ON "event_partner_program_versions" USING btree ("organization_id","event_id","version");--> statement-breakpoint
CREATE INDEX "event_partner_program_versions_active_idx" ON "event_partner_program_versions" USING btree ("organization_id","event_id","status","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_partner_rule_acceptances_unique" ON "event_partner_rule_acceptances" USING btree ("partner_id","program_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_partners_customer_unique" ON "event_partners" USING btree ("organization_id","event_id","customer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_partners_public_slug_unique" ON "event_partners" USING btree ("organization_id","event_id","public_slug");--> statement-breakpoint
CREATE INDEX "event_partners_directory_idx" ON "event_partners" USING btree ("organization_id","event_id","qualification_status","sort_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_attribution_revisions_order_version_unique" ON "partner_attribution_revisions" USING btree ("order_id","order_version");--> statement-breakpoint
CREATE INDEX "partner_attribution_revisions_partner_time_idx" ON "partner_attribution_revisions" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_commission_inquiries_status_idx" ON "partner_commission_inquiries" USING btree ("organization_id","event_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_commission_items_commission_item_unique" ON "partner_commission_items" USING btree ("commission_id","order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_commission_items_id_scope_unique" ON "partner_commission_items" USING btree ("id","commission_id");--> statement-breakpoint
CREATE INDEX "partner_commission_items_order_idx" ON "partner_commission_items" USING btree ("order_id","order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_commissions_order_attribution_unique" ON "partner_commissions" USING btree ("order_id","attribution_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_commissions_partner_sequence_unique" ON "partner_commissions" USING btree ("partner_id","sequence");--> statement-breakpoint
CREATE INDEX "partner_commissions_partner_status_idx" ON "partner_commissions" USING btree ("partner_id","status","release_at");--> statement-breakpoint
CREATE INDEX "partner_commissions_event_status_idx" ON "partner_commissions" USING btree ("organization_id","event_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_financial_event_inbox_key_unique" ON "partner_financial_event_inbox" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "partner_financial_event_inbox_due_idx" ON "partner_financial_event_inbox" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_ledger_entries_business_key_unique" ON "partner_ledger_entries" USING btree ("business_key");--> statement-breakpoint
CREATE INDEX "partner_ledger_entries_balance_idx" ON "partner_ledger_entries" USING btree ("partner_id","balance_bucket","created_at");--> statement-breakpoint
CREATE INDEX "partner_ledger_entries_order_fact_idx" ON "partner_ledger_entries" USING btree ("commission_id","commission_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_batches_idempotency_unique" ON "partner_payout_batches" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "partner_payout_batches_status_idx" ON "partner_payout_batches" USING btree ("organization_id","status","cutoff_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_documents_digest_unique" ON "partner_payout_documents" USING btree ("organization_id","content_digest","kind");--> statement-breakpoint
CREATE INDEX "partner_payout_documents_request_idx" ON "partner_payout_documents" USING btree ("payout_request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_executions_request_version_unique" ON "partner_payout_executions" USING btree ("payout_request_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_executions_merchant_bill_unique" ON "partner_payout_executions" USING btree ("merchant_bill_no");--> statement-breakpoint
CREATE INDEX "partner_payout_executions_status_idx" ON "partner_payout_executions" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_recipients_active_fingerprint_unique" ON "partner_payout_recipients" USING btree ("organization_id","account_fingerprint") WHERE "partner_payout_recipients"."status" in ('pending', 'verified');--> statement-breakpoint
CREATE INDEX "partner_payout_recipients_partner_idx" ON "partner_payout_recipients" USING btree ("partner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_requests_idempotency_unique" ON "partner_payout_requests" USING btree ("partner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "partner_payout_requests_status_idx" ON "partner_payout_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "partner_reconciliation_runs_status_idx" ON "partner_reconciliation_runs" USING btree ("organization_id","kind","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_referral_links_code_unique" ON "partner_referral_links" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_referral_links_active_partner_unique" ON "partner_referral_links" USING btree ("partner_id") WHERE "partner_referral_links"."status" = 'active';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_partner_attribution_revision_id_partner_attribution_revisions_id_fk" FOREIGN KEY ("partner_attribution_revision_id") REFERENCES "public"."partner_attribution_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_partner_attribution_idx" ON "payments" USING btree ("partner_attribution_revision_id");