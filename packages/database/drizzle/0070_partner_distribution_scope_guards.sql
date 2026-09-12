ALTER TABLE "partner_attribution_revisions" DROP CONSTRAINT "partner_attribution_revisions_referral_link_fk";
--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" DROP CONSTRAINT "partner_commission_inquiries_adjustment_ledger_entry_id_partner_ledger_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" DROP CONSTRAINT "partner_ledger_entries_commission_id_partner_commissions_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" DROP CONSTRAINT "partner_ledger_entries_commission_item_id_partner_commission_items_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" DROP CONSTRAINT "partner_ledger_entries_payout_request_id_partner_payout_requests_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" DROP CONSTRAINT "partner_ledger_entries_payout_execution_id_partner_payout_executions_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_payout_documents" DROP CONSTRAINT "partner_payout_documents_payout_request_id_partner_payout_requests_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_payout_documents" DROP CONSTRAINT "partner_payout_documents_payout_execution_id_partner_payout_executions_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_payout_executions" DROP CONSTRAINT "partner_payout_executions_batch_fk";
--> statement-breakpoint
ALTER TABLE "partner_payout_requests" DROP CONSTRAINT "partner_payout_requests_batch_id_partner_payout_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_payout_requests" DROP CONSTRAINT "partner_payout_requests_recipient_fk";
--> statement-breakpoint
ALTER TABLE "partner_reconciliation_runs" DROP CONSTRAINT "partner_reconciliation_runs_batch_id_partner_payout_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_referral_visit_days" DROP CONSTRAINT "partner_referral_visit_days_link_fk";
--> statement-breakpoint
DROP INDEX "partner_payout_documents_digest_unique";--> statement-breakpoint
ALTER TABLE "partner_commission_items" ADD CONSTRAINT "partner_commission_items_id_partner_scope_unique" UNIQUE("id","partner_id","organization_id","event_id");--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_id_scope_unique" UNIQUE("id","partner_id","organization_id","event_id");--> statement-breakpoint
ALTER TABLE "partner_payout_batches" ADD CONSTRAINT "partner_payout_batches_id_scope_unique" UNIQUE("id","organization_id","event_id");--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD CONSTRAINT "partner_payout_executions_id_scope_unique" UNIQUE("id","partner_id","organization_id","event_id");--> statement-breakpoint
ALTER TABLE "partner_payout_recipients" ADD CONSTRAINT "partner_payout_recipients_id_scope_unique" UNIQUE("id","partner_id","organization_id");--> statement-breakpoint
ALTER TABLE "partner_referral_links" ADD CONSTRAINT "partner_referral_links_id_scope_unique" UNIQUE("id","partner_id","organization_id","event_id");--> statement-breakpoint
ALTER TABLE "partner_attribution_revisions" ADD CONSTRAINT "partner_attribution_revisions_referral_scope_fk" FOREIGN KEY ("referral_link_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_referral_links"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_commission_inquiries" ADD CONSTRAINT "partner_commission_inquiries_adjustment_scope_fk" FOREIGN KEY ("adjustment_ledger_entry_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_ledger_entries"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_financial_event_inbox" ADD CONSTRAINT "partner_financial_event_inbox_event_scope_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_commission_scope_fk" FOREIGN KEY ("commission_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_commissions"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_commission_item_scope_fk" FOREIGN KEY ("commission_item_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_commission_items"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_payout_request_scope_fk" FOREIGN KEY ("payout_request_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_payout_requests"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ledger_entries" ADD CONSTRAINT "partner_ledger_entries_payout_execution_scope_fk" FOREIGN KEY ("payout_execution_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_payout_executions"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_batches" ADD CONSTRAINT "partner_payout_batches_event_scope_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_documents" ADD CONSTRAINT "partner_payout_documents_request_scope_fk" FOREIGN KEY ("payout_request_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_payout_requests"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_documents" ADD CONSTRAINT "partner_payout_documents_execution_scope_fk" FOREIGN KEY ("payout_execution_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_payout_executions"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_executions" ADD CONSTRAINT "partner_payout_executions_batch_scope_fk" FOREIGN KEY ("batch_id","organization_id","event_id") REFERENCES "public"."partner_payout_batches"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_requests" ADD CONSTRAINT "partner_payout_requests_recipient_scope_fk" FOREIGN KEY ("recipient_id","partner_id","organization_id") REFERENCES "public"."partner_payout_recipients"("id","partner_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_requests" ADD CONSTRAINT "partner_payout_requests_batch_scope_fk" FOREIGN KEY ("batch_id","organization_id","event_id") REFERENCES "public"."partner_payout_batches"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_reconciliation_runs" ADD CONSTRAINT "partner_reconciliation_runs_event_scope_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."events"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_reconciliation_runs" ADD CONSTRAINT "partner_reconciliation_runs_batch_scope_fk" FOREIGN KEY ("batch_id","organization_id","event_id") REFERENCES "public"."partner_payout_batches"("id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referral_visit_days" ADD CONSTRAINT "partner_referral_visit_days_link_scope_fk" FOREIGN KEY ("referral_link_id","partner_id","organization_id","event_id") REFERENCES "public"."partner_referral_links"("id","partner_id","organization_id","event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_documents_digest_unique" ON "partner_payout_documents" USING btree ("organization_id","payout_request_id","content_digest","kind");
