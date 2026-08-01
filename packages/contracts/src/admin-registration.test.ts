import { describe, expect, it } from 'vitest';
import { AdminRegistrationDetailSchema } from './index';

const detail = {
  id: 'registration-1',
  eventId: 101,
  registrationCode: 'REG-001',
  status: 'confirmed',
  attendee: {
    name: '王欣怡',
    mobile: '13800138000',
    email: 'wang.xinyi@example.com',
    company: '远景科技',
    title: '市场总监',
    city: '上海',
  },
  ticketType: {
    id: 'ticket-1',
    name: '早鸟票',
    description: '大会通票',
    price: 39900,
    currency: 'CNY',
    remaining: 10,
    benefits: [],
    recommended: false,
  },
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
  invoiceRequired: false,
  marketingConsent: false,
  consentSnapshot: {},
};

describe('AdminRegistrationDetailSchema', () => {
  it('requires customer details when the relation is included', () => {
    expect(
      AdminRegistrationDetailSchema.safeParse({
        ...detail,
        customerRelation: 'included',
      }).success,
    ).toBe(false);
  });

  it('rejects customer details when account access is restricted', () => {
    expect(
      AdminRegistrationDetailSchema.safeParse({
        ...detail,
        customerRelation: 'restricted',
        customer: {},
      }).success,
    ).toBe(false);
  });
});
