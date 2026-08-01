import { describe, expect, it } from 'vitest';
import {
  allowedInvoiceTransitions,
  buildInvoiceExportCsv,
  canTransitionInvoice,
  invoiceExportRequiresWorker,
} from './invoice-operations.service.js';

describe('invoice lifecycle', () => {
  it('only permits transitions defined by the approved lifecycle', () => {
    expect(canTransitionInvoice('awaiting_details', 'pending_review')).toBe(true);
    expect(canTransitionInvoice('pending_review', 'issuing')).toBe(true);
    expect(canTransitionInvoice('issuing', 'issued')).toBe(true);
    expect(canTransitionInvoice('issued', 'awaiting_details')).toBe(false);
    expect(canTransitionInvoice('cancelled', 'pending_review')).toBe(false);
    expect(allowedInvoiceTransitions('adjustment_required')).toEqual(['voided']);
  });

  it('routes exports at fifty thousand rows to the worker', () => {
    expect(invoiceExportRequiresWorker(49_999)).toBe(false);
    expect(invoiceExportRequiresWorker(50_000)).toBe(true);
  });

  it('guards spreadsheet formulas in exported invoice fields', () => {
    const csv = buildInvoiceExportCsv([
      {
        requestNo: 'INV-1',
        eventName: '=HYPERLINK("https://example.com")',
        orderNo: 'ORDER-1',
        title: '+危险公式',
        amount: 100,
        status: 'issued',
        requestedAt: '2026-07-28T00:00:00.000Z',
      },
    ]);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).toContain(`'+危险公式`);
  });
});
