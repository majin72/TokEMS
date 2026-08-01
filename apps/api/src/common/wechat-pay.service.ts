import {
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  API_ERROR_CODES,
  type UpdateWeChatPayConfiguration,
  type WeChatNativePayment,
  type WeChatPayConfiguration,
  type WeChatPayConnectionTest,
} from '@conference/contracts';
import {
  auditLogs,
  events,
  orderAccessTokens,
  orders,
  organizationIntegrations,
  payments,
} from '@conference/database';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from './database.service.js';
import { DomainError } from './domain-error.js';
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  integrationEncryptionKeyVersion,
} from './integration-credentials.js';

const PROVIDER = 'wechatpay';
const WECHAT_PAY_API = 'https://api.mch.weixin.qq.com';

type PublicConfig = {
  enabled: boolean;
  appId: string;
  mchId: string;
  merchantCertificateSerial: string;
  platformPublicKeyId: string;
};

type Credentials = {
  merchantPrivateKey: string;
  apiV3Key: string;
  platformPublicKey: string;
};

type WeChatNotification = {
  id: string;
  event_type: string;
  resource: {
    algorithm: string;
    ciphertext: string;
    nonce: string;
    associated_data?: string;
  };
};

type WeChatTransaction = {
  appid: string;
  mchid: string;
  out_trade_no: string;
  transaction_id: string;
  trade_state: string;
  amount: {
    total: number;
    payer_total?: number;
    currency: string;
    payer_currency?: string;
  };
  success_time?: string;
};

function safeConfig(value: Record<string, unknown>): PublicConfig {
  return {
    enabled: value.enabled === true,
    appId: typeof value.appId === 'string' ? value.appId : '',
    mchId: typeof value.mchId === 'string' ? value.mchId : '',
    merchantCertificateSerial:
      typeof value.merchantCertificateSerial === 'string' ? value.merchantCertificateSerial : '',
    platformPublicKeyId:
      typeof value.platformPublicKeyId === 'string' ? value.platformPublicKeyId : '',
  };
}

function readErrorMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as { message?: string; code?: string };
    return [parsed.code, parsed.message].filter(Boolean).join(' · ') || '微信支付请求失败';
  } catch {
    return '微信支付请求失败';
  }
}

@Injectable()
export class WeChatPayService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private db() {
    if (!this.database.db) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '微信支付需要 PostgreSQL 持久化模式',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.database.db;
  }

  private notifyUrl(organizationId: string) {
    const base =
      process.env.PUBLIC_API_URL?.replace(/\/+$/, '') ??
      `http://localhost:${process.env.API_PORT ?? '4100'}`;
    return `${base}/api/v1/payments/wechat/notify/${organizationId}`;
  }

  private async integration(organizationId: string) {
    const [row] = await this.db()
      .select()
      .from(organizationIntegrations)
      .where(
        and(
          eq(organizationIntegrations.organizationId, organizationId),
          eq(organizationIntegrations.provider, PROVIDER),
        ),
      )
      .limit(1);
    return row;
  }

  private credentials(
    organizationId: string,
    encryptedCredentials: string | null,
  ): Credentials | undefined {
    if (!encryptedCredentials) return undefined;
    const value = decryptIntegrationCredentials(organizationId, PROVIDER, encryptedCredentials);
    if (!value.merchantPrivateKey || !value.apiV3Key || !value.platformPublicKey) {
      return undefined;
    }
    return value as Credentials;
  }

  async getConfiguration(organizationId: string): Promise<WeChatPayConfiguration> {
    const row = await this.integration(organizationId);
    const config = safeConfig(row?.config ?? {});
    const secrets = this.credentials(organizationId, row?.encryptedCredentials ?? null);
    return {
      ...config,
      notifyUrl: this.notifyUrl(organizationId),
      status:
        row?.status === 'verified' || row?.status === 'error' || row?.status === 'configured'
          ? row.status
          : 'unconfigured',
      lastVerifiedAt: row?.lastVerifiedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      secretsPresent: {
        merchantPrivateKey: Boolean(secrets?.merchantPrivateKey),
        apiV3Key: Boolean(secrets?.apiV3Key),
        platformPublicKey: Boolean(secrets?.platformPublicKey),
      },
    };
  }

  async updateConfiguration(
    organizationId: string,
    actorId: string,
    input: UpdateWeChatPayConfiguration,
  ): Promise<WeChatPayConfiguration> {
    const existing = await this.integration(organizationId);
    const previousCredentials = this.credentials(
      organizationId,
      existing?.encryptedCredentials ?? null,
    );
    const credentials: Credentials = {
      merchantPrivateKey:
        input.merchantPrivateKey?.trim() ?? previousCredentials?.merchantPrivateKey ?? '',
      apiV3Key: input.apiV3Key ?? previousCredentials?.apiV3Key ?? '',
      platformPublicKey:
        input.platformPublicKey?.trim() ?? previousCredentials?.platformPublicKey ?? '',
    };
    if (Object.values(credentials).some((value) => !value)) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '首次配置需要完整填写商户私钥、APIv3 密钥和微信支付公钥',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      createPrivateKey(credentials.merchantPrivateKey);
      createPublicKey(credentials.platformPublicKey);
    } catch {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '商户私钥或微信支付公钥格式无效',
        HttpStatus.BAD_REQUEST,
      );
    }
    const config: PublicConfig = {
      enabled: input.enabled,
      appId: input.appId,
      mchId: input.mchId,
      merchantCertificateSerial: input.merchantCertificateSerial,
      platformPublicKeyId: input.platformPublicKeyId,
    };
    const encryptedCredentials = encryptIntegrationCredentials(
      organizationId,
      PROVIDER,
      credentials,
    );
    const now = new Date();
    await this.db().transaction(async (tx) => {
      await tx
        .insert(organizationIntegrations)
        .values({
          organizationId,
          provider: PROVIDER,
          status: 'configured',
          config,
          encryptedCredentials,
          keyVersion: integrationEncryptionKeyVersion(),
          lastVerifiedAt: null,
          lastError: null,
          updatedBy: actorId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [organizationIntegrations.organizationId, organizationIntegrations.provider],
          set: {
            status: 'configured',
            config,
            encryptedCredentials,
            keyVersion: integrationEncryptionKeyVersion(),
            lastVerifiedAt: null,
            lastError: null,
            updatedBy: actorId,
            updatedAt: now,
          },
        });
      await tx.insert(auditLogs).values({
        organizationId,
        actorId,
        action: 'integration.wechatpay.update',
        resourceType: 'organization_integration',
        resourceId: existing?.id ?? organizationId,
        before: existing ? { status: existing.status, config: safeConfig(existing.config) } : null,
        after: { status: 'configured', config },
        traceId: crypto.randomUUID(),
      });
    });
    return this.getConfiguration(organizationId);
  }

  private signRequest(
    method: string,
    canonicalUrl: string,
    body: string,
    config: PublicConfig,
    credentials: Credentials,
  ) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const message = `${method}\n${canonicalUrl}\n${timestamp}\n${nonce}\n${body}\n`;
    const signer = createSign('RSA-SHA256');
    signer.update(message);
    signer.end();
    const signature = signer.sign(credentials.merchantPrivateKey, 'base64');
    return `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.merchantCertificateSerial}",signature="${signature}"`;
  }

  private verifyResponse(
    response: Response,
    body: string,
    config: PublicConfig,
    credentials: Credentials,
  ) {
    const timestamp = response.headers.get('wechatpay-timestamp') ?? '';
    const nonce = response.headers.get('wechatpay-nonce') ?? '';
    const signature = response.headers.get('wechatpay-signature') ?? '';
    const serial = response.headers.get('wechatpay-serial') ?? '';
    const timestampValue = Number(timestamp);
    if (
      !timestamp ||
      !Number.isFinite(timestampValue) ||
      Math.abs(Date.now() / 1000 - timestampValue) > 300 ||
      !nonce ||
      !signature ||
      serial !== config.platformPublicKeyId
    ) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信支付响应缺少可信签名',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${timestamp}\n${nonce}\n${body}\n`);
    verifier.end();
    if (!verifier.verify(credentials.platformPublicKey, signature, 'base64')) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信支付响应签名校验失败',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private async request(
    method: string,
    canonicalUrl: string,
    body: Record<string, unknown> | undefined,
    config: PublicConfig,
    credentials: Credentials,
  ) {
    const serialized = body ? JSON.stringify(body) : '';
    let response: Response;
    try {
      response = await fetch(`${WECHAT_PAY_API}${canonicalUrl}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: this.signRequest(method, canonicalUrl, serialized, config, credentials),
          'Wechatpay-Serial': config.platformPublicKeyId,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          'User-Agent': 'TokEMS/0.1',
        },
        ...(body ? { body: serialized } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '暂时无法连接微信支付，请稍后重试',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const responseBody = await response.text();
    const hasResponseSignature = Boolean(response.headers.get('wechatpay-signature'));
    if (response.ok || hasResponseSignature) {
      this.verifyResponse(response, responseBody, config, credentials);
    }
    if (!response.ok) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        readErrorMessage(responseBody),
        HttpStatus.BAD_GATEWAY,
      );
    }
    return responseBody ? (JSON.parse(responseBody) as Record<string, unknown>) : {};
  }

  private async requiredIntegration(
    organizationId: string,
    options: { requireVerified?: boolean } = {},
  ) {
    const row = await this.integration(organizationId);
    const config = safeConfig(row?.config ?? {});
    const credentials = this.credentials(organizationId, row?.encryptedCredentials ?? null);
    if (!row || !config.enabled || !config.appId || !config.mchId || !credentials) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '微信支付尚未完成配置',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (options.requireVerified && row.status !== 'verified') {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '微信支付连接尚未验证通过',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (
      process.env.NODE_ENV === 'production' &&
      !this.notifyUrl(organizationId).startsWith('https://')
    ) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '生产环境的微信支付回调地址必须使用 HTTPS',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { row, config, credentials };
  }

  async testConnection(organizationId: string, actorId: string): Promise<WeChatPayConnectionTest> {
    const { config, credentials } = await this.requiredIntegration(organizationId);
    const verifiedAt = new Date();
    try {
      const echoMessage = `tokems-${organizationId}-${verifiedAt.getTime()}`;
      const result = await this.request(
        'POST',
        '/v3/security/echo',
        { echo_message: echoMessage },
        config,
        credentials,
      );
      if (result.echo_message !== echoMessage) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '微信支付应答内容与验证请求不一致',
          HttpStatus.BAD_GATEWAY,
        );
      }
      await this.db()
        .update(organizationIntegrations)
        .set({
          status: 'verified',
          lastVerifiedAt: verifiedAt,
          lastError: null,
          updatedBy: actorId,
          updatedAt: verifiedAt,
        })
        .where(
          and(
            eq(organizationIntegrations.organizationId, organizationId),
            eq(organizationIntegrations.provider, PROVIDER),
          ),
        );
      return {
        ok: true,
        status: 'verified',
        message: '连接验证通过，可以创建微信 Native 支付订单。',
        verifiedAt: verifiedAt.toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '微信支付连接验证失败';
      await this.db()
        .update(organizationIntegrations)
        .set({
          status: 'error',
          lastVerifiedAt: verifiedAt,
          lastError: message.slice(0, 500),
          updatedBy: actorId,
          updatedAt: verifiedAt,
        })
        .where(
          and(
            eq(organizationIntegrations.organizationId, organizationId),
            eq(organizationIntegrations.provider, PROVIDER),
          ),
        );
      return {
        ok: false,
        status: 'error',
        message,
        verifiedAt: verifiedAt.toISOString(),
      };
    }
  }

  async prepareNativePayment(orderId: string, accessToken: string): Promise<WeChatNativePayment> {
    const tokenHash = createHash('sha256').update(accessToken).digest('hex');
    const [row] = await this.db()
      .select({
        order: orders,
        eventName: events.name,
        tokenScopes: orderAccessTokens.scopes,
      })
      .from(orders)
      .innerJoin(events, eq(events.id, orders.eventId))
      .innerJoin(
        orderAccessTokens,
        and(
          eq(orderAccessTokens.orderId, orders.id),
          eq(orderAccessTokens.tokenHash, tokenHash),
          isNull(orderAccessTokens.revokedAt),
          gt(orderAccessTokens.expiresAt, new Date()),
        ),
      )
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row || !row.order || !row.tokenScopes.includes('order:read')) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '订单访问链接无效或已经过期',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (row.order.status !== 'pending_payment' || row.order.expiresAt <= new Date()) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '当前订单无法发起支付',
        HttpStatus.CONFLICT,
      );
    }
    const { config, credentials } = await this.requiredIntegration(row.order.organizationId, {
      requireVerified: true,
    });
    const existingCodeUrl = await this.db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`wechatpay:prepare:${orderId}`}, 0))`,
      );
      const [existingPayment] = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.orderId, orderId),
            eq(payments.provider, PROVIDER),
            eq(payments.status, 'pending'),
          ),
        )
        .limit(1);
      const existingPayload = existingPayment?.payload as
        { codeUrl?: unknown; preparingAt?: unknown } | undefined;
      if (typeof existingPayload?.codeUrl === 'string') return existingPayload.codeUrl;
      const preparingAt =
        typeof existingPayload?.preparingAt === 'string'
          ? new Date(existingPayload.preparingAt)
          : undefined;
      if (
        preparingAt &&
        !Number.isNaN(preparingAt.getTime()) &&
        Date.now() - preparingAt.getTime() < 15_000
      ) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '微信支付二维码正在生成，请稍后重试',
          HttpStatus.CONFLICT,
        );
      }
      const claimPayload = {
        preparingAt: new Date().toISOString(),
        outTradeNo: row.order.orderNo,
      };
      if (existingPayment) {
        await tx
          .update(payments)
          .set({ payload: claimPayload, updatedAt: new Date() })
          .where(eq(payments.id, existingPayment.id));
      } else {
        await tx.insert(payments).values({
          orderId,
          provider: PROVIDER,
          status: 'pending',
          amount: row.order.amount,
          currency: row.order.currency,
          payload: claimPayload,
        });
      }
      return undefined;
    });
    if (existingCodeUrl) {
      return {
        orderId,
        codeUrl: existingCodeUrl,
        expiresAt: row.order.expiresAt.toISOString(),
      };
    }
    const result = await this.request(
      'POST',
      '/v3/pay/transactions/native',
      {
        appid: config.appId,
        mchid: config.mchId,
        description: row.eventName.slice(0, 127),
        out_trade_no: row.order.orderNo,
        time_expire: row.order.expiresAt.toISOString(),
        notify_url: this.notifyUrl(row.order.organizationId),
        amount: {
          total: row.order.amount,
          currency: row.order.currency,
        },
      },
      config,
      credentials,
    );
    const codeUrl = typeof result.code_url === 'string' ? result.code_url : '';
    if (!codeUrl) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '微信支付未返回付款二维码',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const payload = {
      codeUrl,
      preparedAt: new Date().toISOString(),
      outTradeNo: row.order.orderNo,
    };
    await this.db()
      .update(payments)
      .set({ status: 'pending', payload, updatedAt: new Date() })
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.provider, PROVIDER),
          eq(payments.status, 'pending'),
        ),
      );
    return {
      orderId,
      codeUrl,
      expiresAt: row.order.expiresAt.toISOString(),
    };
  }

  async queryNativePayment(orderId: string, accessToken: string) {
    const tokenHash = createHash('sha256').update(accessToken).digest('hex');
    const [row] = await this.db()
      .select({
        order: orders,
        tokenScopes: orderAccessTokens.scopes,
      })
      .from(orders)
      .innerJoin(
        orderAccessTokens,
        and(
          eq(orderAccessTokens.orderId, orders.id),
          eq(orderAccessTokens.tokenHash, tokenHash),
          isNull(orderAccessTokens.revokedAt),
          gt(orderAccessTokens.expiresAt, new Date()),
        ),
      )
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row || !row.tokenScopes.includes('order:read')) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '订单访问链接无效或已经过期',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!['pending_payment', 'processing'].includes(row.order.status)) return undefined;

    const [payment] = await this.db()
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.provider, PROVIDER),
          eq(payments.status, 'pending'),
        ),
      )
      .limit(1);
    if (!payment) return undefined;
    const payload =
      payment.payload && typeof payment.payload === 'object'
        ? (payment.payload as Record<string, unknown>)
        : {};
    const lastQueriedAt =
      typeof payload.lastQueriedAt === 'string' ? new Date(payload.lastQueriedAt) : undefined;
    if (
      lastQueriedAt &&
      !Number.isNaN(lastQueriedAt.getTime()) &&
      Date.now() - lastQueriedAt.getTime() < 15_000
    ) {
      return undefined;
    }
    await this.db()
      .update(payments)
      .set({
        payload: { ...payload, lastQueriedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    const { config, credentials } = await this.requiredIntegration(row.order.organizationId);
    const result = (await this.request(
      'GET',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(row.order.orderNo)}?mchid=${encodeURIComponent(config.mchId)}`,
      undefined,
      config,
      credentials,
    )) as unknown as WeChatTransaction;
    const occurredAt = result.success_time ? new Date(result.success_time) : undefined;
    if (
      result.appid !== config.appId ||
      result.mchid !== config.mchId ||
      result.out_trade_no !== row.order.orderNo ||
      !result.transaction_id ||
      !occurredAt ||
      Number.isNaN(occurredAt.getTime()) ||
      result.amount?.total !== row.order.amount ||
      result.amount?.currency !== row.order.currency
    ) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信支付查单结果与本地订单不一致',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return {
      orderId,
      externalId: result.transaction_id,
      amount: result.amount.total,
      currency: result.amount.currency,
      occurredAt: occurredAt.toISOString(),
    };
  }

  async parseNotification(
    organizationId: string,
    rawBody: Buffer,
    headers: {
      timestamp: string | undefined;
      nonce: string | undefined;
      signature: string | undefined;
      serial: string | undefined;
    },
  ) {
    const { config, credentials } = await this.requiredIntegration(organizationId);
    const timestamp = Number(headers.timestamp);
    if (
      !headers.timestamp ||
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > 300 ||
      headers.serial !== config.platformPublicKeyId
    ) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信支付回调时间戳或公钥标识无效',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headers.timestamp}\n${headers.nonce ?? ''}\n${rawBody.toString('utf8')}\n`);
    verifier.end();
    if (
      !headers.signature ||
      !verifier.verify(credentials.platformPublicKey, headers.signature, 'base64')
    ) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信支付回调签名校验失败',
        HttpStatus.UNAUTHORIZED,
      );
    }
    let notification: WeChatNotification;
    try {
      notification = JSON.parse(rawBody.toString('utf8')) as WeChatNotification;
    } catch {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信支付回调不是有效的 JSON',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      notification.event_type !== 'TRANSACTION.SUCCESS' ||
      notification.resource?.algorithm !== 'AEAD_AES_256_GCM'
    ) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信支付回调事件类型不受支持',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const ciphertext = Buffer.from(notification.resource.ciphertext, 'base64');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(credentials.apiV3Key, 'utf8'),
        Buffer.from(notification.resource.nonce, 'utf8'),
      );
      decipher.setAAD(Buffer.from(notification.resource.associated_data ?? '', 'utf8'));
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
      const plaintext = Buffer.concat([
        decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
        decipher.final(),
      ]);
      const transaction = JSON.parse(plaintext.toString('utf8')) as WeChatTransaction;
      if (
        transaction.appid !== config.appId ||
        transaction.mchid !== config.mchId ||
        transaction.trade_state !== 'SUCCESS' ||
        !transaction.transaction_id ||
        !transaction.out_trade_no
      ) {
        throw new Error('Unexpected transaction payload');
      }
      const [order] = await this.db()
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.orderNo, transaction.out_trade_no),
          ),
        )
        .limit(1);
      if (
        !order ||
        order.amount !== transaction.amount.total ||
        order.currency !== transaction.amount.currency
      ) {
        throw new Error('Order amount does not match');
      }
      return {
        orderId: order.id,
        externalId: transaction.transaction_id,
        amount: transaction.amount.total,
        currency: transaction.amount.currency,
        occurredAt: transaction.success_time ?? new Date().toISOString(),
        notificationId: notification.id,
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信支付回调内容无法解密或与订单不匹配',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
