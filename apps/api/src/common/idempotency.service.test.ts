import { describe, expect, it } from 'vitest';
import { idempotencyRequestHash } from './idempotency.service.js';

describe('idempotency request hashing', () => {
  it('treats reordered object keys as the same request and changed values as a conflict', () => {
    const first = idempotencyRequestHash({
      invoiceId: 'invoice-1',
      action: { reason: '资料完整', code: 'A-01' },
    });
    const reordered = idempotencyRequestHash({
      action: { code: 'A-01', reason: '资料完整' },
      invoiceId: 'invoice-1',
    });
    const changed = idempotencyRequestHash({
      invoiceId: 'invoice-1',
      action: { reason: '资料需修改', code: 'A-01' },
    });

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });
});
