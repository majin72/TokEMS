import { describe, expect, it } from 'vitest';
import { adminLoginThrottleLimit } from './auth-throttle.js';

describe('adminLoginThrottleLimit', () => {
  it('keeps the strict production and unspecified deployment limit', () => {
    expect(adminLoginThrottleLimit({ DEPLOYMENT_MODE: 'production' })).toBe(10);
    expect(adminLoginThrottleLimit({})).toBe(10);
  });

  it('allows the complete loopback smoke suite in local deployment mode', () => {
    expect(adminLoginThrottleLimit({ DEPLOYMENT_MODE: 'local' })).toBe(100);
  });
});
