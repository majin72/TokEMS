import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
} from './integration-credentials.js';

const TEST_KEY = Buffer.from('conference-test-payment-key-2026').toString('base64');

describe('integration credentials encryption', () => {
  const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  const previousKeyVersion = process.env.INTEGRATION_ENCRYPTION_KEY_VERSION;
  const previousKeys = process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
  const previousNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY_VERSION;
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
    if (previousKeyVersion === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY_VERSION;
    else process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = previousKeyVersion;
    if (previousKeys === undefined) delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
    else process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = previousKeys;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  it('round-trips credentials without including plaintext in storage', () => {
    const credentials = {
      merchantPrivateKey: 'private-value',
      apiV3Key: '12345678901234567890123456789012',
      platformPublicKey: 'public-value',
    };
    const encrypted = encryptIntegrationCredentials('org-1', 'wechatpay', credentials);

    expect(encrypted).not.toContain(credentials.apiV3Key);
    expect(decryptIntegrationCredentials('org-1', 'wechatpay', encrypted)).toEqual(credentials);
  });

  it('binds ciphertext to the organization and provider', () => {
    const encrypted = encryptIntegrationCredentials('org-1', 'wechatpay', {
      apiV3Key: '12345678901234567890123456789012',
    });

    expect(() => decryptIntegrationCredentials('org-2', 'wechatpay', encrypted)).toThrow(
      '服务密钥无法解密',
    );
  });

  it('rejects the published demonstration key in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.from(
      'conference-local-payment-key-26!',
    ).toString('base64');

    expect(() =>
      encryptIntegrationCredentials('org-1', 'wechatpay', { apiV3Key: 'secret' }),
    ).toThrow('生产环境禁止使用公开的演示加密主密钥');
  });

  it('decrypts existing credentials during a key rotation', () => {
    const encrypted = encryptIntegrationCredentials('org-1', 'wechatpay', {
      apiV3Key: '12345678901234567890123456789012',
    });
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = '2';
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.from(
      'conference-test-payment-key-2027',
    ).toString('base64');
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ 1: TEST_KEY });

    expect(decryptIntegrationCredentials('org-1', 'wechatpay', encrypted)).toEqual({
      apiV3Key: '12345678901234567890123456789012',
    });
  });
});
