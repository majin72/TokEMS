import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'dotenv';

const environmentPath = resolve('.env.tokems.local');
const projectEnvironmentPath = resolve('.env');
const localAuthValues = {
  DEPLOYMENT_MODE: 'local',
  ALLOW_INSECURE_LOCAL_AUTH: 'true',
  CUSTOMER_OTP_MODE: 'fake',
  ADMIN_USERNAME: 'admin',
  ADMIN_EMAIL: 'admin@tokems.local',
  ADMIN_PASSWORD: 'admin',
  VITE_SIMPLE_AUTH: 'true',
};
const productionAuthValues = {
  DEPLOYMENT_MODE: 'production',
  ALLOW_INSECURE_LOCAL_AUTH: 'false',
  CUSTOMER_OTP_MODE: 'provider',
  VITE_SIMPLE_AUTH: 'false',
};
const deprecatedCustomerAuthKeys = ['CUSTOMER_OTP_DEV_RESPONSE', 'NUXT_PUBLIC_SIMPLE_AUTH'];
const placeholderSecrets = new Set([
  'conference-local-development-secret-2026',
  'conference-local-docker-jwt-secret-change-me-2026',
  'replace-with-at-least-32-random-characters',
]);
const localSecretKeys = [
  'JWT_SECRET',
  'CUSTOMER_OTP_PEPPER',
  'CUSTOMER_SESSION_SECRET',
  'NOTIFICATION_PAYLOAD_ENCRYPTION_SECRET',
  'PAYMENT_WEBHOOK_SECRET',
  'NOTIFICATION_WEBHOOK_TOKEN',
];

/**
 * Returns whether a secret is missing, too short, or a known placeholder.
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isUnusableSecret(value) {
  return !value || value.length < 32 || placeholderSecrets.has(value);
}

/**
 * Drops unusable secret overrides so workspace `.env` placeholders cannot
 * clobber generated values from `.env.tokems.local`.
 *
 * @param {Record<string, string | undefined>} values
 * @returns {Record<string, string | undefined>}
 */
function withoutUnusableSecretOverrides(values) {
  const next = { ...values };
  for (const key of localSecretKeys) {
    if (isUnusableSecret(next[key])) delete next[key];
  }
  return next;
}

function isLoopbackBindAddress(value) {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('127.')
  );
}

function adminOriginFor(publicOrigin) {
  const url = new URL(publicOrigin);
  url.hostname = url.hostname === 'localhost' ? 'admin.localhost' : `admin.${url.hostname}`;
  return url.origin;
}

function randomSecret() {
  return randomBytes(48).toString('base64url');
}

function writeLocalEnvironment(values) {
  mkdirSync(dirname(environmentPath), { recursive: true });
  writeFileSync(
    environmentPath,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  chmodSync(environmentPath, 0o600);
}

function createLocalEnvironment() {
  const values = {
    JWT_SECRET: randomSecret(),
    CUSTOMER_OTP_PEPPER: randomSecret(),
    CUSTOMER_SESSION_SECRET: randomSecret(),
    NOTIFICATION_PAYLOAD_ENCRYPTION_SECRET: randomSecret(),
    PAYMENT_WEBHOOK_SECRET: randomSecret(),
    NOTIFICATION_WEBHOOK_TOKEN: randomSecret(),
    ...localAuthValues,
    SEED_DEMO_DATA: 'true',
  };
  writeLocalEnvironment(values);
  return values;
}

function removeDeprecatedCustomerAuthValues(values) {
  const current = { ...values };
  for (const key of deprecatedCustomerAuthKeys) delete current[key];
  return current;
}

export function resolveGatewayEnvironment(overrides, projectEnvironment, saved) {
  const gatewayBindAddress =
    overrides.GATEWAY_BIND_ADDRESS ??
    projectEnvironment.GATEWAY_BIND_ADDRESS ??
    saved.GATEWAY_BIND_ADDRESS ??
    '127.0.0.1';
  const gatewayPort =
    overrides.GATEWAY_PORT ?? projectEnvironment.GATEWAY_PORT ?? saved.GATEWAY_PORT ?? '8088';
  const publicOrigin =
    overrides.PUBLIC_ORIGIN ??
    projectEnvironment.PUBLIC_ORIGIN ??
    saved.PUBLIC_ORIGIN ??
    `http://localhost:${gatewayPort}`;
  return {
    GATEWAY_BIND_ADDRESS: gatewayBindAddress,
    GATEWAY_PORT: gatewayPort,
    PUBLIC_ORIGIN: publicOrigin,
    ADMIN_ORIGIN:
      overrides.ADMIN_ORIGIN ??
      projectEnvironment.ADMIN_ORIGIN ??
      saved.ADMIN_ORIGIN ??
      adminOriginFor(publicOrigin),
  };
}

export function localComposeEnvironment(overrides = process.env) {
  const projectEnvironment = removeDeprecatedCustomerAuthValues(
    existsSync(projectEnvironmentPath) ? parse(readFileSync(projectEnvironmentPath, 'utf8')) : {},
  );
  const currentOverrides = withoutUnusableSecretOverrides(
    removeDeprecatedCustomerAuthValues(overrides),
  );
  const deploymentMode =
    currentOverrides.DEPLOYMENT_MODE ??
    projectEnvironment.DEPLOYMENT_MODE ??
    localAuthValues.DEPLOYMENT_MODE;
  if (deploymentMode === 'production') {
    return {
      ...withoutUnusableSecretOverrides(projectEnvironment),
      ...currentOverrides,
      ...productionAuthValues,
    };
  }
  let saved = existsSync(environmentPath)
    ? parse(readFileSync(environmentPath, 'utf8'))
    : createLocalEnvironment();
  const hasDeprecatedCustomerAuthValues = deprecatedCustomerAuthKeys.some((key) => key in saved);
  if (
    hasDeprecatedCustomerAuthValues ||
    Object.entries(localAuthValues).some(([key, value]) => saved[key] !== value)
  ) {
    saved = { ...removeDeprecatedCustomerAuthValues(saved), ...localAuthValues };
    writeLocalEnvironment(saved);
  }
  const gatewayEnvironment = resolveGatewayEnvironment(currentOverrides, projectEnvironment, saved);
  if (!isLoopbackBindAddress(gatewayEnvironment.GATEWAY_BIND_ADDRESS)) {
    throw new Error('Local fake OTP deployment requires GATEWAY_BIND_ADDRESS to be loopback');
  }
  return {
    ...saved,
    ...withoutUnusableSecretOverrides(projectEnvironment),
    ...currentOverrides,
    ...localAuthValues,
    ...gatewayEnvironment,
    // Local docker keeps demo seed on by default; project `.env` often ships
    // `SEED_DEMO_DATA=false` for production templates and must not clobber it.
    SEED_DEMO_DATA:
      currentOverrides.SEED_DEMO_DATA ?? saved.SEED_DEMO_DATA ?? 'true',
  };
}

export const localComposeEnvironmentPath = environmentPath;
