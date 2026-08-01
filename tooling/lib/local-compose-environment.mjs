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
  const currentOverrides = removeDeprecatedCustomerAuthValues(overrides);
  const deploymentMode =
    currentOverrides.DEPLOYMENT_MODE ??
    projectEnvironment.DEPLOYMENT_MODE ??
    localAuthValues.DEPLOYMENT_MODE;
  if (deploymentMode === 'production') {
    return {
      ...projectEnvironment,
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
    ...currentOverrides,
    ...localAuthValues,
    ...gatewayEnvironment,
    SEED_DEMO_DATA: currentOverrides.SEED_DEMO_DATA ?? saved.SEED_DEMO_DATA ?? 'true',
  };
}

export const localComposeEnvironmentPath = environmentPath;
