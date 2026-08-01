import { describe, expect, it } from 'vitest';
import { resolveBuildInfo } from './index.js';

describe('resolveBuildInfo', () => {
  it('normalizes valid release metadata for a service', () => {
    expect(
      resolveBuildInfo('api', {
        BUILD_SHA: 'ABCDEF1234567890',
        BUILD_TIME: '2026-08-01T01:02:03.000Z',
        BUILD_MIGRATION: '0024_jittery_victor_mancha.sql',
      }),
    ).toEqual({
      service: 'api',
      sha: 'abcdef1234567890',
      builtAt: '2026-08-01T01:02:03.000Z',
      migration: '0024_jittery_victor_mancha.sql',
    });
  });

  it('uses explicit unknown values when build metadata is absent or malformed', () => {
    expect(
      resolveBuildInfo('worker', {
        BUILD_SHA: 'main',
        BUILD_TIME: 'today',
        BUILD_MIGRATION: '../secret',
      }),
    ).toEqual({
      service: 'worker',
      sha: 'unknown',
      builtAt: 'unknown',
      migration: 'unknown',
    });
  });
});
