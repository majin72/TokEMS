import { describe, expect, it } from 'vitest';
import {
  customerOtpRetrySeconds,
  maskCustomerMobile,
  normalizeCustomerMobileInput,
} from './customer-auth';
import { createLocalTicketCode, createLocalTicketIdentity } from './ticket-code';

describe('customer authentication input helpers', () => {
  it('normalizes local and +86 mobile input to eleven digits', () => {
    expect(normalizeCustomerMobileInput('138 0013 8000')).toBe('13800138000');
    expect(normalizeCustomerMobileInput('+86 138-0013-8000')).toBe('13800138000');
    expect(normalizeCustomerMobileInput('13800138000abc999')).toBe('13800138000');
  });

  it('masks complete mobile numbers without hiding partial input', () => {
    expect(maskCustomerMobile('+8613800138000')).toBe('138****8000');
    expect(maskCustomerMobile('13800')).toBe('13800');
  });

  it('derives retry time from the wall-clock deadline', () => {
    expect(customerOtpRetrySeconds(60_000, 0)).toBe(60);
    expect(customerOtpRetrySeconds(60_000, 59_001)).toBe(1);
    expect(customerOtpRetrySeconds(60_000, 60_500)).toBe(0);
  });
});

describe('local ticket code fallback', () => {
  it('uses the same ten-character uppercase contract as server-issued tickets', () => {
    for (let index = 0; index < 1_000; index += 1) {
      expect(createLocalTicketCode()).toMatch(/^TOK-T-[A-Z0-9]{16}$/u);
    }
  });

  it('encodes the issued ticket code in the local QR payload', () => {
    const identity = createLocalTicketIdentity('event-2026');

    expect(identity.qrPayload).toBe(`conference:event-2026:${identity.code}`);
  });
});
