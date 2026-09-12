import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { grantAllows } from '../common/auth.guard.js';
import { AdminPartnerController } from './partner-distribution.module.js';

const REQUIRED_GRANTS_METADATA = 'conference.required_grants';
const REQUIRED_ALL_GRANTS_METADATA = 'conference.required_all_grants';

describe('partner distribution administration permissions', () => {
  it('keeps payout review, execution, and export as explicit financial grants', () => {
    expect(grantAllows(['event.*'], 'event.partner.manage')).toBe(true);
    expect(grantAllows(['event.*'], 'event.commission.read')).toBe(true);
    expect(grantAllows(['event.*'], 'event.commission.manage')).toBe(false);
    expect(grantAllows(['event.*'], 'event.payout.review')).toBe(false);
    expect(grantAllows(['event.*'], 'event.payout.execute')).toBe(false);
    expect(grantAllows(['event.*'], 'event.payout.export')).toBe(false);
    expect(grantAllows(['event.payout.execute'], 'event.payout.execute')).toBe(true);
  });

  it('requires both payout review and execution to create a batch', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_ALL_GRANTS_METADATA,
        AdminPartnerController.prototype.createBatch,
      ),
    ).toEqual(['event.payout.review', 'event.payout.execute']);
  });

  it('protects transfer execution and reconciliation exports independently', () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_GRANTS_METADATA,
        AdminPartnerController.prototype.payouts,
      ),
    ).toEqual(['event.payout.review']);
    expect(
      Reflect.getMetadata(
        REQUIRED_GRANTS_METADATA,
        AdminPartnerController.prototype.executeBatch,
      ),
    ).toEqual(['event.payout.execute']);
    expect(
      Reflect.getMetadata(
        REQUIRED_GRANTS_METADATA,
        AdminPartnerController.prototype.exportPayouts,
      ),
    ).toEqual(['event.payout.export']);
    expect(
      Reflect.getMetadata(
        REQUIRED_GRANTS_METADATA,
        AdminPartnerController.prototype.adjustCommission,
      ),
    ).toEqual(['event.commission.manage']);
    expect(
      Reflect.getMetadata(
        REQUIRED_GRANTS_METADATA,
        AdminPartnerController.prototype.createReconciliation,
      ),
    ).toEqual(['event.payout.execute']);
  });
});
