import { describe, expect, it } from 'vitest';
import { localDateTimeToIso } from './timezone';

describe('localDateTimeToIso', () => {
  it('interprets a datetime-local value in the selected conference timezone', () => {
    expect(localDateTimeToIso('2027-06-18T09:00', 'Asia/Shanghai')).toBe(
      '2027-06-18T01:00:00.000Z',
    );
    expect(localDateTimeToIso('2027-06-18T09:00', 'America/New_York')).toBe(
      '2027-06-18T13:00:00.000Z',
    );
  });

  it('rejects a local time skipped by daylight-saving transition', () => {
    expect(() => localDateTimeToIso('2027-03-14T02:30', 'America/New_York')).toThrow(
      '所选时区在该时刻不存在',
    );
  });
});
