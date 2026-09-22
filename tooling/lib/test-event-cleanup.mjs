import { createRequire } from 'node:module';

const requireFromDatabase = createRequire(
  new URL('../../packages/database/package.json', import.meta.url),
);
const { Pool } = requireFromDatabase('pg');

const defaultDatabaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://conference:conference@localhost:15432/conference';

export async function cleanupTestEvents(eventIds, databaseUrl = defaultDatabaseUrl) {
  const uniqueEventIds = [...new Set(eventIds.filter(Boolean))];
  if (uniqueEventIds.length === 0) return;
  if (uniqueEventIds.some((id) => !Number.isInteger(id) || id <= 0 || id > 2147483647)) {
    throw new TypeError('Test cleanup requires explicit positive integer event IDs');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
          await client.query('begin');
          await client.query(
            'select id from events where id = any($1::integer[]) order by id for update',
            [uniqueEventIds],
          );
          // Clear restrictive child references before the event cascade, in one
          // transaction so deferred order/item invariants see their parent deleted too.
          const partnerTables = [
            'event_partner_program_versions',
            'event_partners',
            'event_partner_profile_versions',
            'event_partner_rule_acceptances',
            'partner_referral_links',
            'partner_referral_visit_days',
            'partner_attribution_revisions',
            'partner_financial_event_inbox',
            'partner_commissions',
            'partner_commission_items',
            'partner_payout_batches',
            'partner_payout_recipients',
            'partner_payout_requests',
            'partner_payout_executions',
            'partner_ledger_entries',
            'partner_payout_documents',
            'partner_commission_inquiries',
            'partner_reconciliation_runs',
          ];
          const eventChildTables = [
            'notification_deliveries',
            'invoice_document_access_links',
            'invoice_requests',
            'refund_item_allocations',
            'refund_request_items',
            'inventory_reservations',
            'order_items',
          ];
          const tables = [...partnerTables, ...eventChildTables];
          const { rows } = await client.query(
            `select name from unnest($1::text[]) as requested(name)
             where to_regclass('public.' || name) is not null`,
            [tables],
          );
          const existingTables = new Set(rows.map((row) => row.name));
          // Resolve encrypted invitation replays through their exact registration;
          // the claim tokens themselves cascade when those registrations are deleted.
          await client.query(
            `delete from idempotency_keys replay
             using attendee_claim_tokens claim, registrations registration
             where replay.scope like 'claim-invitation:%'
               and replay.response_body->>'tokenId' = claim.id::text
               and claim.registration_id = registration.id
               and registration.event_id = any($1::integer[])`,
            [uniqueEventIds],
          );

          if (existingTables.has('event_partners')) {
            const payoutBatchIds = existingTables.has('partner_payout_batches')
              ? (
                  await client.query(
                    `select distinct batch_id::text as id
                     from (
                       select id as batch_id from partner_payout_batches
                       where event_id = any($1::integer[])
                       union all
                       select batch_id from partner_payout_requests
                       where event_id = any($1::integer[]) and batch_id is not null
                       union all
                       select batch_id from partner_payout_executions
                       where event_id = any($1::integer[])
                       union all
                       select batch_id from partner_reconciliation_runs
                       where event_id = any($1::integer[]) and batch_id is not null
                     ) candidate_batches`,
                    [uniqueEventIds],
                  )
                ).rows.map((row) => row.id)
              : [];

            // A payment keeps its attribution revision for settlement. Clear that
            // pointer before deleting the event's append-only partner records.
            await client.query(
              `update payments payment
               set partner_attribution_revision_id = null
               from orders scoped_order
               where payment.order_id = scoped_order.id
                 and scoped_order.event_id = any($1::integer[])
                 and payment.partner_attribution_revision_id is not null`,
              [uniqueEventIds],
            );

            const partnerEventTables = [
              'partner_payout_documents',
              'partner_commission_inquiries',
              'partner_ledger_entries',
              'partner_payout_executions',
              'partner_reconciliation_runs',
              'partner_payout_requests',
              'partner_commission_items',
              'partner_commissions',
              'partner_attribution_revisions',
              'partner_financial_event_inbox',
              'partner_referral_visit_days',
              'event_partner_rule_acceptances',
              'event_partner_profile_versions',
              'partner_referral_links',
            ];
            for (const table of partnerEventTables) {
              if (!existingTables.has(table)) continue;
              await client.query(
                `delete from public.${table} where event_id = any($1::integer[])`,
                [uniqueEventIds],
              );
            }

            if (existingTables.has('partner_payout_recipients')) {
              await client.query(
                `delete from partner_payout_recipients recipient
                 using event_partners partner
                 where recipient.partner_id = partner.id
                   and partner.event_id = any($1::integer[])`,
                [uniqueEventIds],
              );
            }
            await client.query('delete from event_partners where event_id = any($1::integer[])', [
              uniqueEventIds,
            ]);
            if (existingTables.has('event_partner_program_versions')) {
              await client.query(
                'delete from event_partner_program_versions where event_id = any($1::integer[])',
                [uniqueEventIds],
              );
            }
            if (payoutBatchIds.length > 0) {
              await client.query(
                `delete from partner_payout_batches batch
                 where batch.id = any($1::uuid[])
                   and not exists (
                     select 1 from partner_payout_requests request where request.batch_id = batch.id
                   )
                   and not exists (
                     select 1 from partner_payout_executions execution where execution.batch_id = batch.id
                   )
                   and not exists (
                     select 1 from partner_reconciliation_runs run where run.batch_id = batch.id
                   )`,
                [payoutBatchIds],
              );
            }
          }

          for (const table of eventChildTables) {
            if (!existingTables.has(table)) continue;
            await client.query(`delete from public.${table} where event_id = any($1::integer[])`, [
              uniqueEventIds,
            ]);
          }
          await client.query('delete from events where id = any($1::integer[])', [uniqueEventIds]);
          await client.query('commit');
          break;
        } catch (error) {
          await client.query('rollback').catch(() => {});
          const retryable = error?.code === '40P01' || error?.code === '40001';
          if (!retryable || attempt === 5) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 150));
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
