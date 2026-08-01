import {
  createCipheriv,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';

/**
 * Creates isolated RSA key material for WeChat Pay unit tests.
 * Never reuse these fixtures with production credentials.
 *
 * @returns Merchant/platform PEM keys and a fake platform public key id.
 */
export function createWeChatPayTestKeys() {
  const merchantKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platformKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    platformPublicKeyId: 'PUB_KEY_ID_TEST_FIXTURE',
    apiV3Key: randomBytes(16).toString('hex'),
    merchantPrivateKey: merchantKeys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    platformPrivateKey: platformKeys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    platformPublicKey: platformKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/**
 * Signs a WeChat Pay API response body using the platform private key.
 *
 * @param body - Response body text
 * @param platformPrivateKey - Platform PEM private key
 * @param platformPublicKeyId - Wechatpay-Serial header value
 * @returns Signature headers for fetch Response mocks
 */
export function signWeChatPayTestResponse(
  body: string,
  platformPrivateKey: string,
  platformPublicKeyId: string,
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(8).toString('hex');
  const signer = createSign('RSA-SHA256');
  signer.update(`${timestamp}\n${nonce}\n${body}\n`);
  signer.end();
  return {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-signature': signer.sign(platformPrivateKey, 'base64'),
    'wechatpay-serial': platformPublicKeyId,
  };
}

/**
 * Builds an AES-GCM encrypted WeChat payment notification resource for tests.
 *
 * @param apiV3Key - 32-character APIv3 key
 * @param plaintext - JSON string of the decrypted transaction payload
 * @returns Notification resource fields used by parseNotification
 */
export function encryptWeChatPayTestResource(apiV3Key: string, plaintext: string) {
  const nonce = randomBytes(12).toString('base64url').slice(0, 12);
  const associatedData = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: Buffer.concat([encrypted, authTag]).toString('base64'),
    nonce,
    associated_data: associatedData,
  };
}
