import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

type DeploymentOriginEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | 'DEPLOYMENT_MODE'
    | 'PUBLIC_ORIGIN'
    | 'ADMIN_ORIGIN'
    | 'PUBLIC_WEB_URL'
    | 'ADMIN_WEB_URL'
    | 'PUBLIC_SITE_URL'
    | 'PUBLIC_API_URL'
  >
>;

function exactOrigin(value: string, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL origin`);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must contain only scheme, host, and optional port`);
  }
  return url.origin;
}

export function isLoopbackHostname(hostname: string) {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('127.')
  );
}

export function resolveDeploymentOrigins(environment: DeploymentOriginEnvironment = process.env) {
  const publicOrigin = environment.PUBLIC_ORIGIN
    ? exactOrigin(environment.PUBLIC_ORIGIN, 'PUBLIC_ORIGIN')
    : undefined;
  const adminOrigin = environment.ADMIN_ORIGIN
    ? exactOrigin(environment.ADMIN_ORIGIN, 'ADMIN_ORIGIN')
    : undefined;
  const publicWebOrigin = environment.PUBLIC_WEB_URL
    ? exactOrigin(environment.PUBLIC_WEB_URL, 'PUBLIC_WEB_URL')
    : undefined;
  const adminWebOrigin = environment.ADMIN_WEB_URL
    ? exactOrigin(environment.ADMIN_WEB_URL, 'ADMIN_WEB_URL')
    : undefined;

  if (publicOrigin && adminOrigin && publicOrigin === adminOrigin) {
    throw new Error('PUBLIC_ORIGIN and ADMIN_ORIGIN must use distinct browser origins');
  }

  if (environment.DEPLOYMENT_MODE === 'production') {
    if (!publicOrigin) {
      throw new Error('PUBLIC_ORIGIN is required when DEPLOYMENT_MODE=production');
    }
    if (!adminOrigin) {
      throw new Error('ADMIN_ORIGIN is required when DEPLOYMENT_MODE=production');
    }
    const publicUrl = new URL(publicOrigin);
    const adminUrl = new URL(adminOrigin);
    for (const [name, url] of [
      ['PUBLIC_ORIGIN', publicUrl],
      ['ADMIN_ORIGIN', adminUrl],
    ] as const) {
      if (url.protocol !== 'https:') {
        throw new Error(`${name} must use HTTPS when DEPLOYMENT_MODE=production`);
      }
      if (isLoopbackHostname(url.hostname)) {
        throw new Error(`${name} must not use a loopback host in production`);
      }
    }
    if (adminUrl.hostname !== `admin.${publicUrl.hostname}`) {
      throw new Error('ADMIN_ORIGIN hostname must be admin.<PUBLIC_ORIGIN hostname>');
    }
    if (adminUrl.port !== publicUrl.port) {
      throw new Error('PUBLIC_ORIGIN and ADMIN_ORIGIN must use the same external port');
    }
    for (const [name, value, expected] of [
      ['PUBLIC_WEB_URL', publicWebOrigin, publicOrigin],
      ['ADMIN_WEB_URL', adminWebOrigin, adminOrigin],
      [
        'PUBLIC_SITE_URL',
        environment.PUBLIC_SITE_URL
          ? exactOrigin(environment.PUBLIC_SITE_URL, 'PUBLIC_SITE_URL')
          : undefined,
        publicOrigin,
      ],
      [
        'PUBLIC_API_URL',
        environment.PUBLIC_API_URL
          ? exactOrigin(environment.PUBLIC_API_URL, 'PUBLIC_API_URL')
          : undefined,
        publicOrigin,
      ],
    ] as const) {
      if (value && value !== expected) {
        throw new Error(`${name} must match its canonical deployment origin`);
      }
    }
  }

  const corsOrigins = [publicOrigin, adminOrigin, publicWebOrigin, adminWebOrigin].filter(
    (value): value is string => Boolean(value),
  );

  return {
    publicOrigin,
    adminOrigin,
    corsOrigins: corsOrigins.length
      ? [...new Set(corsOrigins)]
      : ['http://localhost:3000', 'http://localhost:3200'],
  };
}

export function normalizeMainlandMobile(value: string) {
  const digits = value.trim().replace(/[^\d+]/g, '');
  const national = digits.replace(/^\+?86/, '');
  if (!/^1[3-9]\d{9}$/.test(national)) {
    throw new Error('请输入有效的中国大陆手机号');
  }
  return `+86${national}`;
}

export function maskMobile(value: string) {
  const national = value.replace(/^\+86/, '');
  return national.length === 11
    ? `${national.slice(0, 3)}****${national.slice(-4)}`
    : `***${value.slice(-4)}`;
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacDigest(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function secureDigestEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function createOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

const TICKET_CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const STRICT_TICKET_CODE_PATTERN = /^TOK-T-[A-Z0-9]{10}$/u;
const READABLE_TICKET_CODE_PATTERN = /^TOK-T-[A-Z0-9_-]{8,32}$/u;

export function createTicketCode() {
  let suffix = '';
  for (let index = 0; index < 10; index += 1) {
    suffix += TICKET_CODE_ALPHABET[randomInt(0, TICKET_CODE_ALPHABET.length)];
  }
  return `TOK-T-${suffix}`;
}

export function isStrictTicketCode(value: string) {
  return STRICT_TICKET_CODE_PATTERN.test(value);
}

export function isReadableTicketCode(value: string) {
  return READABLE_TICKET_CODE_PATTERN.test(value);
}

function encryptionKey(secret: string) {
  return createHash('sha256').update(secret).digest();
}

export function sealSecret(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function openSecret(value: string, secret: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Encrypted secret has an invalid format');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

type IntegrationCredentialEnvelope = {
  version: 1;
  keyVersion?: number;
  iv: string;
  tag: string;
  ciphertext: string;
};

function decodeIntegrationKey(configured: string, label: string) {
  const value = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');
  if (value.length !== 32) throw new Error(`${label}格式无效`);
  return value;
}

export function integrationEncryptionKeyVersion() {
  const value = Number(process.env.INTEGRATION_ENCRYPTION_KEY_VERSION ?? '1');
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('服务密钥加密主密钥版本无效');
  }
  return value;
}

function integrationEncryptionKeys() {
  const configured = process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error('服务密钥加密主密钥尚未配置');
  if (
    process.env.NODE_ENV === 'production' &&
    [
      Buffer.from('conference-local-payment-key-26!').toString('base64'),
      'replace-with-32-random-bytes-encoded-as-base64',
    ].includes(configured)
  ) {
    throw new Error('生产环境禁止使用公开的演示加密主密钥');
  }
  const currentVersion = integrationEncryptionKeyVersion();
  const keys = new Map<number, Buffer>([
    [currentVersion, decodeIntegrationKey(configured, '服务密钥加密主密钥')],
  ]);
  const previous = process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS?.trim();
  if (previous) {
    let values: Record<string, unknown>;
    try {
      values = JSON.parse(previous) as Record<string, unknown>;
    } catch {
      throw new Error('历史服务密钥配置不是有效的 JSON');
    }
    for (const [rawVersion, rawKey] of Object.entries(values)) {
      const version = Number(rawVersion);
      if (!Number.isSafeInteger(version) || version < 1 || typeof rawKey !== 'string') {
        throw new Error('历史服务密钥版本配置无效');
      }
      if (!keys.has(version)) {
        keys.set(version, decodeIntegrationKey(rawKey, `历史服务密钥 v${version}`));
      }
    }
  }
  return { currentVersion, keys };
}

function integrationEncryptionKey(version?: number) {
  const keyring = integrationEncryptionKeys();
  const selectedVersion = version ?? keyring.currentVersion;
  const key = keyring.keys.get(selectedVersion);
  if (!key) throw new Error(`服务密钥加密主密钥 v${selectedVersion} 尚未配置`);
  return { key, version: selectedVersion };
}

function integrationAdditionalData(organizationId: string, provider: string) {
  return Buffer.from(`tokems:${organizationId}:${provider}:v1`, 'utf8');
}

export function encryptIntegrationCredentials(
  organizationId: string,
  provider: string,
  credentials: Record<string, string>,
) {
  const iv = randomBytes(12);
  const currentKey = integrationEncryptionKey();
  const cipher = createCipheriv('aes-256-gcm', currentKey.key, iv);
  cipher.setAAD(integrationAdditionalData(organizationId, provider));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ]);
  const envelope: IntegrationCredentialEnvelope = {
    version: 1,
    keyVersion: currentKey.version,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

export function decryptIntegrationCredentials(
  organizationId: string,
  provider: string,
  encrypted: string,
): Record<string, string> {
  try {
    const envelope = JSON.parse(
      Buffer.from(encrypted, 'base64').toString('utf8'),
    ) as IntegrationCredentialEnvelope;
    if (envelope.version !== 1) throw new Error('Unsupported credential envelope');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      integrationEncryptionKey(envelope.keyVersion ?? 1).key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAAD(integrationAdditionalData(organizationId, provider));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const value = JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== 'object' ||
      Object.values(value).some((item) => typeof item !== 'string')
    ) {
      throw new Error('Invalid credential payload');
    }
    return value as Record<string, string>;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('服务密钥') || message.startsWith('生产环境')) throw error;
    throw new Error('服务密钥无法解密，请检查加密主密钥', { cause: error });
  }
}

export function csrfToken(sessionId: string, secret: string) {
  return createHmac('sha256', secret).update(`customer-session:${sessionId}`).digest('base64url');
}
