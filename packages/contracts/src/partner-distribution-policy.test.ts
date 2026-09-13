import { describe, expect, it } from 'vitest';
import {
  calculateCommissionLine,
  exceedsMerchantTransferLimit,
  merchantTransferStateDisposition,
  shouldApplyMerchantTransferState,
  resolveCommissionReleaseAt,
  resolvePartnerCommissionRate,
} from './partner-distribution-policy.js';

describe('partner distribution financial policy', () => {
  it('counts a batch order once when resolving a tier', () => {
    const program = {
      mode: 'order_count_tiered' as const,
      fixedRateBps: 1000,
      tiers: [
        { minimumOrderCount: 3, rateBps: 1200 },
        { minimumOrderCount: 10, rateBps: 1500 },
      ],
    };
    expect(resolvePartnerCommissionRate(program, 9, null)).toBe(1200);
    expect(resolvePartnerCommissionRate(program, 10, null)).toBe(1500);
    expect(resolvePartnerCommissionRate(program, 100, 1800)).toBe(1800);
  });

  it('rounds every eligible order line down to cents', () => {
    expect(
      calculateCommissionLine({
        grossAmount: 1999,
        refundedAmount: 500,
        rateBps: 1000,
        eligible: true,
      }),
    ).toEqual({
      grossAmount: 1999,
      refundedAmount: 500,
      eligibleAmount: 1499,
      commissionAmount: 149,
    });
    expect(calculateCommissionLine({ grossAmount: 1999, rateBps: 1000, eligible: false })).toEqual({
      grossAmount: 1999,
      refundedAmount: 0,
      eligibleAmount: 0,
      commissionAmount: 0,
    });
  });

  it('releases after both the configured delay and refund window buffer', () => {
    const paidAt = new Date('2026-09-01T00:00:00.000Z');
    expect(
      resolveCommissionReleaseAt(paidAt, 7, new Date('2026-09-10T00:00:00.000Z')).toISOString(),
    ).toBe('2026-09-11T00:00:00.000Z');
  });

  it('keeps funds reserved until a transfer reaches a known terminal state', () => {
    expect(merchantTransferStateDisposition('WAIT_USER_CONFIRM')).toEqual({
      terminal: false,
      succeeded: false,
      keepsReservation: true,
    });
    expect(merchantTransferStateDisposition('SUCCESS').succeeded).toBe(true);
    expect(merchantTransferStateDisposition('FAIL').keepsReservation).toBe(false);
  });

  it('does not regress a known transfer state on delayed responses', () => {
    expect(shouldApplyMerchantTransferState('WAIT_USER_CONFIRM', 'PROCESSING')).toBe(false);
    expect(shouldApplyMerchantTransferState('TRANSFERING', 'unknown')).toBe(false);
    expect(shouldApplyMerchantTransferState('unknown', 'PROCESSING')).toBe(true);
    expect(shouldApplyMerchantTransferState('PROCESSING', 'SUCCESS')).toBe(true);
    expect(shouldApplyMerchantTransferState('SUCCESS', 'PROCESSING')).toBe(false);
    expect(shouldApplyMerchantTransferState('CANCELING', 'TRANSFERING')).toBe(false);
    expect(shouldApplyMerchantTransferState('TRANSFERING', 'CANCELING')).toBe(true);
  });

  it('blocks a transfer when any merchant limit would be exceeded', () => {
    expect(
      exceedsMerchantTransferLimit({
        amount: 5000,
        userDayAmount: 6000,
        merchantDayAmount: 20_000,
        merchantMonthAmount: 80_000,
        perTransferLimit: 10_000,
        perUserDayLimit: 10_000,
        merchantDayLimit: 100_000,
        merchantMonthLimit: 1_000_000,
      }),
    ).toBe(true);
  });
});
