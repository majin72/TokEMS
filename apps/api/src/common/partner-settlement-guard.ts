import { HttpStatus } from '@nestjs/common';
import { API_ERROR_CODES } from '@conference/contracts';
import { eventPartners, partnerLedgerEntries, type ConferenceDatabase } from '@conference/database';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DomainError } from './domain-error.js';

// Call after the event payout gate, before making a new settlement commitment.
export async function lockPartnerSettlement(
  tx: Pick<ConferenceDatabase, 'execute' | 'select'>,
  organizationId: string,
  eventId: number,
  ids: string[],
) {
  const partnerIds = [...new Set(ids)].sort();
  if (!partnerIds.length) return;
  for (const partnerId of partnerIds) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`partner-balance:${partnerId}`}, 0))`,
    );
  }
  const partners = await tx
    .select({ settlementHold: eventPartners.settlementHold })
    .from(eventPartners)
    .where(
      and(
        eq(eventPartners.organizationId, organizationId),
        eq(eventPartners.eventId, eventId),
        inArray(eventPartners.id, partnerIds),
      ),
    );
  if (partners.length !== partnerIds.length || partners.some((partner) => partner.settlementHold)) {
    throw new DomainError(
      API_ERROR_CODES.INVALID_STATE_TRANSITION,
      '合作伙伴处于结算暂停状态，请解除暂停后再处理出款',
      HttpStatus.CONFLICT,
    );
  }
  const [recovery] = await tx
    .select({ partnerId: partnerLedgerEntries.partnerId })
    .from(partnerLedgerEntries)
    .where(
      and(
        inArray(partnerLedgerEntries.partnerId, partnerIds),
        eq(partnerLedgerEntries.balanceBucket, 'recovery_due'),
      ),
    )
    .groupBy(partnerLedgerEntries.partnerId)
    .having(sql`sum(${partnerLedgerEntries.amount}) > 0`)
    .limit(1);
  if (recovery) {
    throw new DomainError(
      API_ERROR_CODES.INVALID_STATE_TRANSITION,
      '合作伙伴存在待追偿金额，请先完成财务核对',
      HttpStatus.CONFLICT,
    );
  }
}
