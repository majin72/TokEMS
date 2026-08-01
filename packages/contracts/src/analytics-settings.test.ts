import { describe, expect, it } from 'vitest';
import { AnalyticsSettingsSchema } from './index';

describe('AnalyticsSettingsSchema', () => {
  it('rejects arbitrary custom script providers', () => {
    expect(
      AnalyticsSettingsSchema.safeParse({
        enabled: true,
        provider: 'custom',
        trackingId: '',
        scriptUrl: 'https://attacker.example/script.js',
        siteId: '',
      }).success,
    ).toBe(false);
  });

  it('allows an HTTPS Umami script with a website id', () => {
    expect(
      AnalyticsSettingsSchema.safeParse({
        enabled: true,
        provider: 'umami',
        trackingId: '',
        scriptUrl: 'https://analytics.example.com/script.js',
        siteId: 'trusted-site-id',
      }).success,
    ).toBe(true);
  });
});
