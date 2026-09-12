import { describe, expect, it } from 'vitest';
import {
  AdminEnablePartnerSchema,
  ConfirmPartnerPayoutSettlementSchema,
  CreatePartnerCommissionAdjustmentSchema,
  CreatePartnerPayoutSchema,
  CreatePartnerReconciliationSchema,
  PartnerProgramDraftSchema,
  PartnerTransferConfigurationSchema,
  ReviewPartnerPayoutSchema,
  UpdatePartnerPrivacySchema,
} from './partner-distribution.js';

describe('partner distribution contracts', () => {
  it('uses the approved program defaults', () => {
    const program = PartnerProgramDraftSchema.parse({
      termsTitle: '合作伙伴规则',
      termsContent: '本规则用于大会合作伙伴推广与佣金结算。',
      promotionPolicy: '请使用真实信息推广大会。',
    });
    expect(program.fixedRateBps).toBe(1000);
    expect(program.attributionDays).toBe(30);
    expect(program.settlementDelayDays).toBe(7);
    expect(program.minimumPayoutAmount).toBe(1000);
    expect(program.payoutCadence).toBe('weekly');
  });

  it('rejects tiered rules without a tier', () => {
    expect(
      PartnerProgramDraftSchema.safeParse({
        mode: 'order_count_tiered',
        termsTitle: '合作伙伴规则',
        termsContent: '本规则用于大会合作伙伴推广与佣金结算。',
        promotionPolicy: '请使用真实信息推广大会。',
      }).success,
    ).toBe(false);
  });

  it('keeps public and poster permissions independent', () => {
    const privacy = UpdatePartnerPrivacySchema.parse({
      expectedVersion: 1,
      publicStatus: 'published',
      visibleFields: Object.fromEntries(
        ['avatar', 'displayName', 'company', 'title', 'industry', 'businessIntro', 'businessUrl', 'contactPhone', 'contactEmail', 'wechatId', 'gallery'].map((key) => [key, true]),
      ),
      posterFields: Object.fromEntries(
        ['avatar', 'displayName', 'company', 'title', 'industry', 'businessIntro', 'businessUrl', 'contactPhone', 'contactEmail', 'wechatId', 'gallery'].map((key) => [key, false]),
      ),
    });
    expect(privacy.visibleFields.contactEmail).toBe(true);
    expect(privacy.posterFields.contactEmail).toBe(false);
    expect(
      UpdatePartnerPrivacySchema.safeParse({
        ...privacy,
        visibleFields: { ...privacy.visibleFields, contactEmail: false },
        posterFields: { ...privacy.posterFields, contactEmail: true },
      }).success,
    ).toBe(false);
  });

  it('uses cents for transfer limits and rate basis points', () => {
    expect(PartnerTransferConfigurationSchema.parse({}).singleTransferLimit).toBe(20_000);
    expect(AdminEnablePartnerSchema.parse({ customerUserId: crypto.randomUUID() }).personalRateBps).toBeNull();
  });

  it('keeps financial inputs inside persistent integer and merchant-limit boundaries', () => {
    expect(
      CreatePartnerPayoutSchema.safeParse({
        amount: 1_000_000_001,
        recipientId: crypto.randomUUID(),
        idempotencyKey: 'payout-too-large',
      }).success,
    ).toBe(false);
    expect(
      PartnerTransferConfigurationSchema.safeParse({
        singleTransferLimit: 20_000,
        dailyUserLimit: 10_000,
      }).success,
    ).toBe(false);
  });

  it('validates tax finalization and customer settlement confirmation', () => {
    expect(
      ReviewPartnerPayoutSchema.parse({
        expectedVersion: 2,
        decision: 'approve',
        reason: '资料与税额已经完成核验',
        taxAmount: 125,
      }).taxAmount,
    ).toBe(125);
    expect(ConfirmPartnerPayoutSettlementSchema.parse({ expectedVersion: 3 })).toEqual({
      expectedVersion: 3,
    });
  });

  it('validates ledger adjustments and reconciliations as integer financial facts', () => {
    expect(
      CreatePartnerCommissionAdjustmentSchema.parse({
        partnerId: crypto.randomUUID(),
        amount: -1250,
        reason: '人工复核后冲减重复佣金',
      }).amount,
    ).toBe(-1250);
    expect(
      CreatePartnerReconciliationSchema.parse({
        windowStart: '2026-09-01T00:00:00.000Z',
        windowEnd: '2026-09-02T00:00:00.000Z',
        checkedCount: 20,
        differenceCount: 1,
        differenceAmount: -500,
        evidenceReference: 'wechat-fund-bill-20260901',
        evidenceDigest: 'a'.repeat(64),
      }).kind,
    ).toBe('payouts');
    expect(
      CreatePartnerReconciliationSchema.safeParse({
        windowStart: '2026-09-02T00:00:00.000Z',
        windowEnd: '2026-09-01T00:00:00.000Z',
        checkedCount: 1,
        differenceCount: 0,
        differenceAmount: 500,
        evidenceReference: 'invalid-window',
        evidenceDigest: 'b'.repeat(64),
      }).success,
    ).toBe(false);
  });
});
