import { HttpStatus } from '@nestjs/common';
import { API_ERROR_CODES } from '@conference/contracts';
import {
  decryptIntegrationCredentials as decryptCredentials,
  encryptIntegrationCredentials as encryptCredentials,
  integrationEncryptionKeyVersion as encryptionKeyVersion,
} from '@conference/security';
import { DomainError } from './domain-error.js';

function asDomainError(error: unknown): never {
  throw new DomainError(
    API_ERROR_CODES.INVALID_STATE_TRANSITION,
    error instanceof Error ? error.message : '服务密钥处理失败',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

export function integrationEncryptionKeyVersion() {
  try {
    return encryptionKeyVersion();
  } catch (error) {
    return asDomainError(error);
  }
}

export function encryptIntegrationCredentials(
  organizationId: string,
  provider: string,
  credentials: Record<string, string>,
) {
  try {
    return encryptCredentials(organizationId, provider, credentials);
  } catch (error) {
    return asDomainError(error);
  }
}

export function decryptIntegrationCredentials(
  organizationId: string,
  provider: string,
  encrypted: string,
): Record<string, string> {
  try {
    return decryptCredentials(organizationId, provider, encrypted);
  } catch (error) {
    return asDomainError(error);
  }
}
