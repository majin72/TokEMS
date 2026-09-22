import type { MerchantTransferState, PartnerProgramDraft } from './partner-distribution.js';

export type CommissionLineInput = {
  grossAmount: number;
  refundedAmount?: number;
  rateBps: number;
  eligible: boolean;
};

export function resolvePartnerCommissionRate(
  program: Pick<PartnerProgramDraft, 'mode' | 'fixedRateBps' | 'tiers'>,
  completedOrderCount: number,
  personalRateBps: number | null,
) {
  if (personalRateBps !== null) return personalRateBps;
  if (program.mode === 'fixed') return program.fixedRateBps;
  return [...program.tiers]
    .sort((left, right) => left.minimumOrderCount - right.minimumOrderCount)
    .reduce(
      (rate, tier) => (completedOrderCount >= tier.minimumOrderCount ? tier.rateBps : rate),
      program.fixedRateBps,
    );
}

export function calculateCommissionLine(input: CommissionLineInput) {
  const grossAmount = Math.max(0, Math.trunc(input.grossAmount));
  const refundedAmount = Math.min(grossAmount, Math.max(0, Math.trunc(input.refundedAmount ?? 0)));
  const eligibleAmount = input.eligible ? grossAmount - refundedAmount : 0;
  const commissionAmount = Math.floor((eligibleAmount * input.rateBps) / 10_000);
  return { grossAmount, refundedAmount, eligibleAmount, commissionAmount };
}

export function resolveCommissionReleaseAt(
  paidAt: Date,
  settlementDelayDays: number,
  refundWindowEndsAt: Date | null,
) {
  const delayEnd = new Date(paidAt.getTime() + settlementDelayDays * 24 * 60 * 60 * 1000);
  const refundEnd = refundWindowEndsAt
    ? new Date(refundWindowEndsAt.getTime() + 24 * 60 * 60 * 1000)
    : delayEnd;
  return delayEnd > refundEnd ? delayEnd : refundEnd;
}

export function merchantTransferStateDisposition(state: MerchantTransferState) {
  if (state === 'SUCCESS') return { terminal: true, succeeded: true, keepsReservation: false };
  if (state === 'FAIL' || state === 'CANCELLED') {
    return { terminal: true, succeeded: false, keepsReservation: false };
  }
  return { terminal: false, succeeded: false, keepsReservation: true };
}

const MERCHANT_TRANSFER_STATE_RANK: Record<MerchantTransferState, number> = {
  ACCEPTED: 1,
  PROCESSING: 2,
  WAIT_USER_CONFIRM: 3,
  TRANSFERING: 4,
  CANCELING: 4,
  SUCCESS: 5,
  FAIL: 5,
  CANCELLED: 5,
};

export function shouldApplyMerchantTransferState(
  current: MerchantTransferState | 'prepared' | 'unknown',
  incoming: MerchantTransferState | 'unknown',
) {
  if (current === 'SUCCESS' || current === 'FAIL' || current === 'CANCELLED') return false;
  if (incoming === 'SUCCESS' || incoming === 'FAIL' || incoming === 'CANCELLED') return true;
  if (incoming === 'unknown') return current === 'prepared' || current === 'unknown';
  if (current === 'prepared' || current === 'unknown') return true;
  if (current === 'CANCELING' && incoming === 'TRANSFERING') return false;
  return MERCHANT_TRANSFER_STATE_RANK[incoming] >= MERCHANT_TRANSFER_STATE_RANK[current];
}

export function exceedsMerchantTransferLimit(input: {
  amount: number;
  userDayAmount: number;
  merchantDayAmount: number;
  merchantMonthAmount: number;
  perTransferLimit: number;
  perUserDayLimit: number;
  merchantDayLimit: number;
  merchantMonthLimit: number;
}) {
  return (
    input.amount > input.perTransferLimit ||
    input.userDayAmount + input.amount > input.perUserDayLimit ||
    input.merchantDayAmount + input.amount > input.merchantDayLimit ||
    input.merchantMonthAmount + input.amount > input.merchantMonthLimit
  );
}
