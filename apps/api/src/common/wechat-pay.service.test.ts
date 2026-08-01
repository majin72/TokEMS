import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from './database.service.js';
import { WeChatPayService } from './wechat-pay.service.js';

type RequestMethod = (
  method: string,
  canonicalUrl: string,
  body: Record<string, unknown> | undefined,
  config: {
    enabled: boolean;
    appId: string;
    mchId: string;
    merchantCertificateSerial: string;
    platformPublicKeyId: string;
  },
  credentials: {
    merchantPrivateKey: string;
    apiV3Key: string;
    platformPublicKey: string;
  },
) => Promise<Record<string, unknown>>;

describe('WeChatPayService signed requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('declares the configured platform public key and verifies the signed response', async () => {
    const merchantKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const platformKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const platformPublicKeyId = 'PUB_KEY_ID_TEST_2026';
    const responseBody = JSON.stringify({ echo_message: 'tokems-test' });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = 'response-nonce';
    const signer = createSign('RSA-SHA256');
    signer.update(`${timestamp}\n${nonce}\n${responseBody}\n`);
    signer.end();
    const responseSignature = signer.sign(platformKeys.privateKey, 'base64');
    let requestHeaders: Headers | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        requestHeaders = new Headers(init?.headers);
        return new Response(responseBody, {
          status: 200,
          headers: {
            'wechatpay-timestamp': timestamp,
            'wechatpay-nonce': nonce,
            'wechatpay-signature': responseSignature,
            'wechatpay-serial': platformPublicKeyId,
          },
        });
      }),
    );

    const service = new WeChatPayService(new DatabaseService());
    const request = (service as unknown as { request: RequestMethod }).request.bind(service);
    const result = await request(
      'POST',
      '/v3/security/echo',
      { echo_message: 'tokems-test' },
      {
        enabled: true,
        appId: 'wx-test-app',
        mchId: '1234567890',
        merchantCertificateSerial: 'MERCHANT_SERIAL',
        platformPublicKeyId,
      },
      {
        merchantPrivateKey: merchantKeys.privateKey
          .export({
            type: 'pkcs8',
            format: 'pem',
          })
          .toString(),
        apiV3Key: '12345678901234567890123456789012',
        platformPublicKey: platformKeys.publicKey
          .export({
            type: 'spki',
            format: 'pem',
          })
          .toString(),
      },
    );

    expect(result).toEqual({ echo_message: 'tokems-test' });
    expect(requestHeaders?.get('Wechatpay-Serial')).toBe(platformPublicKeyId);
    expect(requestHeaders?.get('Authorization')).toContain('WECHATPAY2-SHA256-RSA2048');
  });
});
