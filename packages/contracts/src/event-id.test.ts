import { describe, expect, it } from 'vitest';
import { EventIdParamSchema, EventIdSchema } from './index.js';

describe('event ID contract', () => {
  it('accepts numeric IDs and canonical route parameters in the supported range', () => {
    expect(EventIdSchema.parse(101)).toBe(101);
    expect(EventIdSchema.parse(999)).toBe(999);
    expect(EventIdSchema.parse(1000)).toBe(1000);
    expect(EventIdSchema.parse(2_147_483_647)).toBe(2_147_483_647);
    expect(EventIdParamSchema.parse('101')).toBe(101);
    expect(EventIdParamSchema.parse('1000')).toBe(1000);
    expect(EventIdParamSchema.parse('2147483647')).toBe(2_147_483_647);
  });

  it.each([100, 2_147_483_648, 101.5, '101'])('rejects invalid body value %s', (value) => {
    expect(EventIdSchema.safeParse(value).success).toBe(false);
  });

  it.each(['100', '0101', '2147483648', 'abc', '22222222-2222-4222-8222-222222222222'])(
    'rejects invalid route parameter %s',
    (value) => {
      expect(EventIdParamSchema.safeParse(value).success).toBe(false);
    },
  );
});
