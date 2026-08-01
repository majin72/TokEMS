import { describe, expect, it } from 'vitest';
import { grantsAllowAll } from './auth.guard.js';

describe('combined grants', () => {
  it('requires every grant for customer directory export', () => {
    expect(grantsAllowAll(['customer.read'], ['customer.read', 'customer.export'])).toBe(false);
    expect(
      grantsAllowAll(['customer.read', 'customer.export'], ['customer.read', 'customer.export']),
    ).toBe(true);
    expect(grantsAllowAll(['*'], ['customer.read', 'customer.export'])).toBe(true);
  });
});
