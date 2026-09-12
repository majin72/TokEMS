import {
  createDecipheriv,
  createSign,
  createVerify,
  createHmac,
  publicEncrypt,
  constants,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  API_ERROR_CODES,
  MerchantTransferStateSchema,
  PartnerTransferConfigurationSchema,
  exceedsMerchantTransferLimit,
  merchantTransferStateDisposition,
  shouldApplyMerchantTransferState,
  type MerchantTransferState,
} from '@conference/contracts';
import {
  organizationIntegrations,
  auditLogs,
  customerSessions,
  eventPartners,
  partnerFinancialEventInbox,
  partnerLedgerEntries,
  partnerCommissions,
  partnerPayoutBatches,
  partnerPayoutExecutions,
  partnerPayoutRecipients,
  partnerPayoutRequests,
  partnerReconciliationRuns,
} from '@conference/database';
import { openSecret, sealSecret } from '@conference/security';
import { and, eq, gte, inArray, isNull, lt, or, sql, sum } from 'drizzle-orm';
import type { AuthenticatedCustomer } from './customer-auth.service.js';
import { DatabaseService } from './database.service.js';
import { DomainError } from './domain-error.js';
import { decryptIntegrationCredentials } from './integration-credentials.js';
import { RedisService } from './redis.service.js';

const WECHAT_PAY_API = 'https://api.mch.weixin.qq.com';
const PROVIDER = 'wechatpay';
const WECHAT_OAUTH_AUTHORIZE = 'https://open.weixin.qq.com/connect/oauth2/authorize';
const WECHAT_OAUTH_TOKEN = 'https://api.weixin.qq.com/sns/oauth2/access_token';
const ACTIVE_EXECUTION_STATES = [
  'prepared',
  'ACCEPTED',
  'PROCESSING',
  'WAIT_USER_CONFIRM',
  'TRANSFERING',
  'CANCELING',
  'unknown',
  'SUCCESS',
] as const;

type WeChatPublicConfig = {
  appId: string;
  mchId: string;
  merchantCertificateSerial: string;
  platformPublicKeyId: string;
  oauthEnabled: boolean;
};

type WeChatCredentials = {
  merchantPrivateKey: string;
  apiV3Key: string;
  platformPublicKey: string;
  appSecret: string | undefined;
};

type WeChatTransferResponse = {
  transfer_bill_no?: string;
  out_bill_no?: string;
  state?: string;
  package_info?: string;
  fail_reason?: string;
  create_time?: string;
  update_time?: string;
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

function sanitizedTransferResponse(response: WeChatTransferResponse) {
  return {
    ...(response.transfer_bill_no ? { transfer_bill_no: response.transfer_bill_no } : {}),
    ...(response.out_bill_no ? { out_bill_no: response.out_bill_no } : {}),
    ...(response.state ? { state: response.state } : {}),
    ...(response.package_info ? { package_info: response.package_info } : {}),
    ...(response.fail_reason ? { fail_reason: response.fail_reason } : {}),
    ...(response.create_time ? { create_time: response.create_time } : {}),
    ...(response.update_time ? { update_time: response.update_time } : {}),
  };
}

type RecipientOAuthState = {
  purpose: 'partner_recipient_binding';
  organizationId: string;
  eventId: number;
  partnerId: string;
  customerUserId: string;
  customerSessionId: string;
  displayNameCiphertext: string;
};

type RecipientOAuthHandoff = RecipientOAuthState & {
  openidCiphertext: string;
  appId: string;
};

function parseRecipientOAuthState(raw: string): RecipientOAuthState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new DomainError(
      API_ERROR_CODES.UNAUTHORIZED,
      '微信授权状态无效',
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (!value || typeof value !== 'object') {
    throw new DomainError(
      API_ERROR_CODES.UNAUTHORIZED,
      '微信授权状态无效',
      HttpStatus.UNAUTHORIZED,
    );
  }
  const record = value as Record<string, unknown>;
  if (
    record.purpose !== 'partner_recipient_binding' ||
    typeof record.organizationId !== 'string' ||
    !Number.isInteger(record.eventId) ||
    typeof record.partnerId !== 'string' ||
    typeof record.customerUserId !== 'string' ||
    typeof record.customerSessionId !== 'string' ||
    typeof record.displayNameCiphertext !== 'string' ||
    !record.displayNameCiphertext
  ) {
    throw new DomainError(
      API_ERROR_CODES.UNAUTHORIZED,
      '微信授权状态无效',
      HttpStatus.UNAUTHORIZED,
    );
  }
  return record as RecipientOAuthState;
}

function parseRecipientOAuthHandoff(raw: string): RecipientOAuthHandoff {
  const state = parseRecipientOAuthState(raw);
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (
    typeof value.openidCiphertext !== 'string' ||
    !value.openidCiphertext ||
    typeof value.appId !== 'string' ||
    !value.appId
  ) {
    throw new DomainError(
      API_ERROR_CODES.UNAUTHORIZED,
      '微信授权交接信息无效',
      HttpStatus.UNAUTHORIZED,
    );
  }
  return { ...state, openidCiphertext: value.openidCiphertext, appId: value.appId };
}

function payoutDataSecret() {
  const value = process.env.PARTNER_PAYOUT_DATA_SECRET ?? process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PARTNER_PAYOUT_DATA_SECRET with at least 32 characters is required');
    }
    return 'tokems-partner-payout-local-secret-2026';
  }
  return value;
}

function publicConfig(raw: Record<string, unknown>): WeChatPublicConfig {
  return {
    appId: typeof raw.appId === 'string' ? raw.appId : '',
    mchId: typeof raw.mchId === 'string' ? raw.mchId : '',
    merchantCertificateSerial:
      typeof raw.merchantCertificateSerial === 'string' ? raw.merchantCertificateSerial : '',
    platformPublicKeyId: typeof raw.platformPublicKeyId === 'string' ? raw.platformPublicKeyId : '',
    oauthEnabled: raw.oauthEnabled === true,
  };
}

function merchantBillNo() {
  return `TP${Date.now().toString(36)}${randomBytes(7).toString('hex')}`
    .replace(/[^A-Za-z0-9]/gu, '')
    .slice(0, 32)
    .toUpperCase();
}

function startOfShanghaiDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00+08:00`);
}

function startOfShanghaiMonth(now = new Date()) {
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
  return new Date(`${month}-01T00:00:00+08:00`);
}

@Injectable()
export class MerchantTransferService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  private db() {
    if (!this.database.db) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '微信商家转账需要 PostgreSQL 持久化模式',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.database.db;
  }

  private notifyUrl(organizationId: string) {
    const base =
      process.env.PUBLIC_API_URL?.replace(/\/+$/u, '') ??
      `http://localhost:${process.env.API_PORT ?? '4100'}`;
    return `${base}/api/v1/partner-payouts/wechat/notify/${organizationId}`;
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
    if (!row?.encryptedCredentials) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '微信支付商户凭据尚未配置',
        HttpStatus.CONFLICT,
      );
    }
    const config = publicConfig(row.config);
    const transferConfig = PartnerTransferConfigurationSchema.parse(
      row.config.merchantTransfer ?? {},
    );
    const secretValues = decryptIntegrationCredentials(
      organizationId,
      PROVIDER,
      row.encryptedCredentials,
    );
    const credentials: WeChatCredentials = {
      merchantPrivateKey: secretValues.merchantPrivateKey ?? '',
      apiV3Key: secretValues.apiV3Key ?? '',
      platformPublicKey: secretValues.platformPublicKey ?? '',
      appSecret: secretValues.appSecret,
    };
    if (
      row.status !== 'verified' ||
      !transferConfig.enabled ||
      !transferConfig.verifiedAt ||
      !config.appId ||
      !config.mchId ||
      !config.merchantCertificateSerial ||
      !config.platformPublicKeyId ||
      !credentials.merchantPrivateKey ||
      credentials.apiV3Key.length !== 32 ||
      !credentials.platformPublicKey
    ) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '微信商家转账配置未通过验收或当前未启用',
        HttpStatus.CONFLICT,
      );
    }
    return { row, config, transferConfig, credentials };
  }

  private signRequest(
    method: string,
    canonicalUrl: string,
    body: string,
    config: WeChatPublicConfig,
    credentials: WeChatCredentials,
  ) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const signer = createSign('RSA-SHA256');
    signer.update(`${method}\n${canonicalUrl}\n${timestamp}\n${nonce}\n${body}\n`);
    signer.end();
    const signature = signer.sign(credentials.merchantPrivateKey, 'base64');
    return `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.merchantCertificateSerial}",signature="${signature}"`;
  }

  private verifySignedMessage(
    body: string,
    headers: {
      timestamp?: string | undefined;
      nonce?: string | undefined;
      signature?: string | undefined;
      serial?: string | undefined;
    },
    config: WeChatPublicConfig,
    credentials: WeChatCredentials,
  ) {
    const timestamp = headers.timestamp ?? '';
    const nonce = headers.nonce ?? '';
    const signature = headers.signature ?? '';
    if (
      !timestamp ||
      !nonce ||
      !signature ||
      headers.serial !== config.platformPublicKeyId ||
      !Number.isFinite(Number(timestamp)) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
    ) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信转账签名信息无效',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${timestamp}\n${nonce}\n${body}\n`);
    verifier.end();
    if (!verifier.verify(credentials.platformPublicKey, signature, 'base64')) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信转账签名校验失败',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private async request(
    method: 'GET' | 'POST',
    canonicalUrl: string,
    body: Record<string, unknown> | undefined,
    config: WeChatPublicConfig,
    credentials: WeChatCredentials,
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
          'User-Agent': 'TokEMS/partner-payout',
        },
        ...(body ? { body: serialized } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { known: false as const, body: {} as WeChatTransferResponse, status: 0 };
    }
    const raw = await response.text();
    if (response.ok || response.headers.get('wechatpay-signature')) {
      this.verifySignedMessage(
        raw,
        {
          timestamp: response.headers.get('wechatpay-timestamp') ?? undefined,
          nonce: response.headers.get('wechatpay-nonce') ?? undefined,
          signature: response.headers.get('wechatpay-signature') ?? undefined,
          serial: response.headers.get('wechatpay-serial') ?? undefined,
        },
        config,
        credentials,
      );
    }
    const parsed = (() => {
      try {
        return JSON.parse(raw) as WeChatTransferResponse;
      } catch {
        return {};
      }
    })();
    return { known: response.ok, body: parsed, status: response.status };
  }

  private encryptedName(displayName: string, publicKey: string) {
    return publicEncrypt(
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha1',
      },
      Buffer.from(displayName, 'utf8'),
    ).toString('base64');
  }

  async startRecipientOAuth(session: AuthenticatedCustomer, eventId: number, displayName: string) {
    const integration = await this.integration(session.organizationId);
    if (!integration.config.oauthEnabled || !integration.credentials.appSecret) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '微信收款人绑定需要先完成公众号 OAuth 配置',
        HttpStatus.CONFLICT,
      );
    }
    const [[partner], [recentSession]] = await Promise.all([
      this.db()
        .select({ id: eventPartners.id })
        .from(eventPartners)
        .where(
          and(
            eq(eventPartners.organizationId, session.organizationId),
            eq(eventPartners.eventId, eventId),
            eq(eventPartners.customerUserId, session.customerUserId),
            inArray(eventPartners.qualificationStatus, ['active', 'pending_confirmation']),
          ),
        )
        .limit(1),
      this.db()
        .select({ id: customerSessions.id })
        .from(customerSessions)
        .where(
          and(
            eq(customerSessions.id, session.sessionId),
            eq(customerSessions.customerUserId, session.customerUserId),
            eq(customerSessions.organizationId, session.organizationId),
            gte(customerSessions.createdAt, new Date(Date.now() - 30 * 60_000)),
            sql`${customerSessions.revokedAt} is null`,
          ),
        )
        .limit(1),
    ]);
    if (!partner) {
      throw new DomainError(
        API_ERROR_CODES.FORBIDDEN,
        '当前大会未开通合作伙伴资格',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!recentSession) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '绑定微信收款人前请重新登录完成身份验证',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const state = randomBytes(24).toString('base64url');
    const record: RecipientOAuthState = {
      purpose: 'partner_recipient_binding',
      organizationId: session.organizationId,
      eventId,
      partnerId: partner.id,
      customerUserId: session.customerUserId,
      customerSessionId: session.sessionId,
      displayNameCiphertext: sealSecret(displayName, payoutDataSecret()),
    };
    await this.redis
      .getClient()
      .setex(`tokems:partner-recipient-oauth:state:${state}`, 600, JSON.stringify(record));
    const apiBase =
      process.env.PUBLIC_API_URL?.replace(/\/+$/u, '') ??
      `http://localhost:${process.env.API_PORT ?? '4100'}`;
    const callback = encodeURIComponent(
      `${apiBase}/api/v1/partner-payouts/wechat/recipient-oauth/callback`,
    );
    return {
      authorizeUrl:
        `${WECHAT_OAUTH_AUTHORIZE}?appid=${encodeURIComponent(integration.config.appId)}` +
        `&redirect_uri=${callback}&response_type=code&scope=snsapi_base` +
        `&state=${encodeURIComponent(state)}#wechat_redirect`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }

  async consumeRecipientOAuthCallback(code: string, state: string) {
    if (!code || !state || code.length > 200 || state.length > 200) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信授权回调参数无效',
        HttpStatus.BAD_REQUEST,
      );
    }
    const raw = await this.redis
      .getClient()
      .getdel(`tokems:partner-recipient-oauth:state:${state}`);
    if (!raw) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信授权状态无效或已过期',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const record = parseRecipientOAuthState(raw);
    const integration = await this.integration(record.organizationId);
    if (!integration.credentials.appSecret) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '公众号 AppSecret 尚未配置',
        HttpStatus.CONFLICT,
      );
    }
    const tokenUrl =
      `${WECHAT_OAUTH_TOKEN}?appid=${encodeURIComponent(integration.config.appId)}` +
      `&secret=${encodeURIComponent(integration.credentials.appSecret)}` +
      `&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    let tokenBody: { openid?: string; errcode?: number };
    try {
      const response = await fetch(tokenUrl, { signal: AbortSignal.timeout(10_000) });
      tokenBody = (await response.json()) as typeof tokenBody;
    } catch {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '暂时无法完成微信授权，请稍后重试',
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!tokenBody.openid || tokenBody.errcode) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信授权失败，请重新绑定',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const handoffCode = randomBytes(24).toString('base64url');
    const handoff: RecipientOAuthHandoff = {
      ...record,
      openidCiphertext: sealSecret(tokenBody.openid, payoutDataSecret()),
      appId: integration.config.appId,
    };
    await this.redis
      .getClient()
      .setex(`tokems:partner-recipient-oauth:handoff:${handoffCode}`, 120, JSON.stringify(handoff));
    const webBase =
      process.env.PAYOUT_PUBLIC_URL ?? process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000';
    const redirect = new URL(`/account/partnerships/${record.eventId}`, webBase);
    redirect.hash = `partner-recipient-handoff=${encodeURIComponent(handoffCode)}`;
    return redirect.toString();
  }

  async completeRecipientOAuth(
    session: AuthenticatedCustomer,
    eventId: number,
    handoffCode: string,
  ) {
    const raw = await this.redis
      .getClient()
      .getdel(`tokems:partner-recipient-oauth:handoff:${handoffCode}`);
    if (!raw) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信授权交接码无效或已使用',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const handoff = parseRecipientOAuthHandoff(raw);
    if (
      handoff.purpose !== 'partner_recipient_binding' ||
      handoff.organizationId !== session.organizationId ||
      handoff.eventId !== eventId ||
      handoff.customerUserId !== session.customerUserId ||
      handoff.customerSessionId !== session.sessionId
    ) {
      throw new DomainError(
        API_ERROR_CODES.UNAUTHORIZED,
        '微信授权与当前登录身份不一致',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const secret = payoutDataSecret();
    const openid = openSecret(handoff.openidCiphertext, secret);
    const displayName = openSecret(handoff.displayNameCiphertext, secret);
    const fingerprint = createHmac('sha256', secret)
      .update(`${session.organizationId}:wechat_transfer:${openid}`)
      .digest('hex');
    return this.db().transaction(async (tx) => {
      const unsettled = await tx
        .select({ id: partnerPayoutRequests.id })
        .from(partnerPayoutRequests)
        .where(
          and(
            eq(partnerPayoutRequests.partnerId, handoff.partnerId),
            inArray(partnerPayoutRequests.status, [
              'submitted',
              'under_review',
              'approved',
              'batched',
              'executing',
              'unknown',
            ]),
          ),
        )
        .limit(1);
      if (unsettled.length) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '当前仍有未结清提现，请完成后再更换微信收款人',
          HttpStatus.CONFLICT,
        );
      }
      const [fingerprintOwner] = await tx
        .select({ partnerId: partnerPayoutRecipients.partnerId })
        .from(partnerPayoutRecipients)
        .where(
          and(
            eq(partnerPayoutRecipients.organizationId, session.organizationId),
            eq(partnerPayoutRecipients.accountFingerprint, fingerprint),
            inArray(partnerPayoutRecipients.status, ['pending', 'verified']),
          ),
        )
        .limit(1);
      if (fingerprintOwner && fingerprintOwner.partnerId !== handoff.partnerId) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '该微信收款身份已绑定其他合作伙伴，请联系大会财务核验',
          HttpStatus.CONFLICT,
        );
      }
      await tx
        .update(partnerPayoutRecipients)
        .set({
          status: 'disabled',
          disabledAt: new Date(),
          version: sql`${partnerPayoutRecipients.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(partnerPayoutRecipients.partnerId, handoff.partnerId),
            eq(partnerPayoutRecipients.channel, 'wechat_transfer'),
            inArray(partnerPayoutRecipients.status, ['pending', 'verified']),
          ),
        );
      const [recipient] = await tx
        .insert(partnerPayoutRecipients)
        .values({
          organizationId: session.organizationId,
          partnerId: handoff.partnerId,
          customerUserId: session.customerUserId,
          type: 'individual',
          channel: 'wechat_transfer',
          status: 'verified',
          displayNameCiphertext: sealSecret(displayName, secret),
          accountReferenceCiphertext: sealSecret(openid, secret),
          accountFingerprint: fingerprint,
          appId: handoff.appId,
          openIdCiphertext: sealSecret(openid, secret),
          verifiedAt: new Date(),
        })
        .returning();
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        eventId,
        actorId: session.customerUserId,
        actorType: 'customer',
        action: 'partner.payout_recipient.oauth_bound',
        resourceType: 'partner_payout_recipient',
        resourceId: recipient!.id,
        before: {},
        after: { channel: 'wechat_transfer', appId: handoff.appId, fingerprint },
        traceId: randomUUID(),
      });
      return {
        id: recipient!.id,
        channel: recipient!.channel,
        status: recipient!.status,
        verifiedAt: recipient!.verifiedAt,
        version: recipient!.version,
      };
    });
  }

  private async applyState(
    executionId: string,
    state: MerchantTransferState | 'unknown',
    response: WeChatTransferResponse,
  ) {
    const [scope] = await this.db()
      .select({ partnerId: partnerPayoutExecutions.partnerId })
      .from(partnerPayoutExecutions)
      .where(eq(partnerPayoutExecutions.id, executionId))
      .limit(1);
    if (!scope) return undefined;
    return this.db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`partner-balance:${scope.partnerId}`}, 0))`,
      );
      const [execution] = await tx
        .select()
        .from(partnerPayoutExecutions)
        .where(eq(partnerPayoutExecutions.id, executionId))
        .for('update')
        .limit(1);
      if (
        !execution ||
        !shouldApplyMerchantTransferState(
          execution.status as MerchantTransferState | 'prepared' | 'unknown',
          state,
        )
      ) {
        return execution;
      }
      const [request] = await tx
        .select({
          grossAmount: partnerPayoutRequests.grossAmount,
          taxAmount: partnerPayoutRequests.taxAmount,
          netAmount: partnerPayoutRequests.netAmount,
        })
        .from(partnerPayoutRequests)
        .where(eq(partnerPayoutRequests.id, execution.payoutRequestId))
        .for('update')
        .limit(1);
      if (!request) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '提现申请不存在',
          HttpStatus.CONFLICT,
        );
      }
      const disposition = state === 'unknown' ? null : merchantTransferStateDisposition(state);
      const nextRequestStatus =
        state === 'SUCCESS'
          ? 'succeeded'
          : disposition?.terminal
            ? 'failed'
            : state === 'unknown'
              ? 'unknown'
              : 'executing';
      const now = new Date();
      const [updated] = await tx
        .update(partnerPayoutExecutions)
        .set({
          status: state,
          providerTransferBillNo: response.transfer_bill_no ?? execution.providerTransferBillNo,
          responseSnapshot: sanitizedTransferResponse(response),
          confirmationPackage: response.package_info ?? execution.confirmationPackage,
          confirmationExpiresAt:
            state === 'WAIT_USER_CONFIRM'
              ? new Date(Date.now() + 24 * 60 * 60_000)
              : execution.confirmationExpiresAt,
          lastQueriedAt: now,
          queryCount: execution.queryCount + 1,
          failureCode: disposition?.terminal && !disposition.succeeded ? state : null,
          failureReason: response.fail_reason ?? null,
          ...(state === 'SUCCESS' ? { succeededAt: now } : {}),
          ...(disposition?.terminal && !disposition.succeeded ? { failedAt: now } : {}),
          version: execution.version + 1,
          updatedAt: now,
        })
        .where(eq(partnerPayoutExecutions.id, execution.id))
        .returning();
      await tx
        .update(partnerPayoutRequests)
        .set({
          status: nextRequestStatus,
          ...(state === 'SUCCESS' || disposition?.terminal ? { completedAt: now } : {}),
          version: sql`${partnerPayoutRequests.version} + 1`,
          updatedAt: now,
        })
        .where(eq(partnerPayoutRequests.id, execution.payoutRequestId));
      if (state === 'SUCCESS') {
        await tx
          .insert(partnerLedgerEntries)
          .values([
            {
              organizationId: execution.organizationId,
              eventId: execution.eventId,
              partnerId: execution.partnerId,
              payoutRequestId: execution.payoutRequestId,
              payoutExecutionId: execution.id,
              entryType: 'payout',
              balanceBucket: 'reserved',
              amount: -request.grossAmount,
              businessKey: `payout:${execution.payoutRequestId}:wechat:reserved`,
              reason: '微信商家转账到账',
            },
            {
              organizationId: execution.organizationId,
              eventId: execution.eventId,
              partnerId: execution.partnerId,
              payoutRequestId: execution.payoutRequestId,
              payoutExecutionId: execution.id,
              entryType: 'payout',
              balanceBucket: 'paid',
              amount: request.netAmount,
              businessKey: `payout:${execution.payoutRequestId}:wechat:paid`,
              reason: '微信商家转账净额到账',
            },
            ...(request.taxAmount > 0
              ? [
                  {
                    organizationId: execution.organizationId,
                    eventId: execution.eventId,
                    partnerId: execution.partnerId,
                    payoutRequestId: execution.payoutRequestId,
                    payoutExecutionId: execution.id,
                    entryType: 'tax_withholding' as const,
                    balanceBucket: 'paid' as const,
                    amount: request.taxAmount,
                    businessKey: `payout:${execution.payoutRequestId}:wechat:tax`,
                    reason: '微信商家转账代扣税费',
                  },
                ]
              : []),
          ])
          .onConflictDoNothing();
      } else if (disposition?.terminal) {
        const [recovery] = await tx
          .select({ value: sum(partnerLedgerEntries.amount) })
          .from(partnerLedgerEntries)
          .where(
            and(
              eq(partnerLedgerEntries.partnerId, execution.partnerId),
              eq(partnerLedgerEntries.balanceBucket, 'recovery_due'),
            ),
          );
        const recoveryAmount = Math.max(0, Number(recovery?.value ?? 0));
        const recoveredAmount = Math.min(request.grossAmount, recoveryAmount);
        const availableAmount = request.grossAmount - recoveredAmount;
        await tx
          .insert(partnerLedgerEntries)
          .values([
            {
              organizationId: execution.organizationId,
              eventId: execution.eventId,
              partnerId: execution.partnerId,
              payoutRequestId: execution.payoutRequestId,
              payoutExecutionId: execution.id,
              entryType: 'payout_release',
              balanceBucket: 'reserved',
              amount: -request.grossAmount,
              businessKey: `payout:${execution.payoutRequestId}:wechat:release:reserved`,
              reason: '微信商家转账未到账，释放占用金额',
            },
            ...(recoveredAmount > 0
              ? [
                  {
                    organizationId: execution.organizationId,
                    eventId: execution.eventId,
                    partnerId: execution.partnerId,
                    payoutRequestId: execution.payoutRequestId,
                    payoutExecutionId: execution.id,
                    entryType: 'recovery' as const,
                    balanceBucket: 'recovery_due' as const,
                    amount: -recoveredAmount,
                    businessKey: `payout:${execution.payoutRequestId}:wechat:release:recovery`,
                    reason: '释放的微信转账占用金额优先抵扣待追偿金额',
                  },
                ]
              : []),
            ...(availableAmount > 0
              ? [
                  {
                    organizationId: execution.organizationId,
                    eventId: execution.eventId,
                    partnerId: execution.partnerId,
                    payoutRequestId: execution.payoutRequestId,
                    payoutExecutionId: execution.id,
                    entryType: 'payout_release' as const,
                    balanceBucket: 'available' as const,
                    amount: availableAmount,
                    businessKey: `payout:${execution.payoutRequestId}:wechat:release:available`,
                    reason: '微信商家转账未到账，释放占用金额',
                  },
                ]
              : []),
          ])
          .onConflictDoNothing();
        if (recoveryAmount > 0 && recoveredAmount === recoveryAmount) {
          await tx
            .update(partnerCommissions)
            .set({
              status: sql`case
                when ${partnerCommissions.reversedAmount} >= ${partnerCommissions.commissionAmount} then 'reversed'
                when ${partnerCommissions.reversedAmount} > 0 then 'partially_reversed'
                else ${partnerCommissions.status}
              end`,
              version: sql`${partnerCommissions.version} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(partnerCommissions.partnerId, execution.partnerId),
                eq(partnerCommissions.status, 'recovery_due'),
              ),
            );
        }
      }
      const unfinished = await tx
        .select({ id: partnerPayoutRequests.id })
        .from(partnerPayoutRequests)
        .where(
          and(
            eq(partnerPayoutRequests.batchId, execution.batchId),
            inArray(partnerPayoutRequests.status, ['batched', 'executing', 'unknown']),
          ),
        )
        .limit(1);
      if (!unfinished.length) {
        await tx
          .update(partnerPayoutBatches)
          .set({
            status: 'completed',
            completedAt: now,
            version: sql`${partnerPayoutBatches.version} + 1`,
            updatedAt: now,
          })
          .where(eq(partnerPayoutBatches.id, execution.batchId));
      }
      return updated!;
    });
  }

  async executeBatch(
    organizationId: string,
    eventId: number,
    batchId: string,
    actorId: string,
    expectedVersion: number,
  ) {
    const integration = await this.integration(organizationId);
    const prepared = await this.db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`partner-wechat-budget:${organizationId}`}, 0))`,
      );
      const [batch] = await tx
        .select()
        .from(partnerPayoutBatches)
        .where(
          and(
            eq(partnerPayoutBatches.id, batchId),
            eq(partnerPayoutBatches.organizationId, organizationId),
            eq(partnerPayoutBatches.eventId, eventId),
          ),
        )
        .for('update')
        .limit(1);
      if (!batch)
        throw new DomainError(API_ERROR_CODES.NOT_FOUND, '出款批次不存在', HttpStatus.NOT_FOUND);
      if (!batch.eventId) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '组织级跨大会批次暂不支持自动执行',
          HttpStatus.CONFLICT,
        );
      }
      if (
        batch.channel !== 'wechat_transfer' ||
        batch.status !== 'approved' ||
        batch.version !== expectedVersion
      ) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '出款批次状态已更新或渠道不匹配',
          HttpStatus.CONFLICT,
        );
      }
      if (batch.approvedBy === actorId) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '出款执行需要由复核人之外的管理员完成',
          HttpStatus.CONFLICT,
        );
      }
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`partner-payout-gate:${organizationId}:${batch.eventId}`}, 0))`,
      );
      const [unresolvedReconciliation] = await tx
        .select({ id: partnerReconciliationRuns.id })
        .from(partnerReconciliationRuns)
        .where(
          and(
            eq(partnerReconciliationRuns.organizationId, organizationId),
            eq(partnerReconciliationRuns.kind, 'payouts'),
            inArray(partnerReconciliationRuns.status, ['running', 'difference', 'failed']),
            or(
              eq(partnerReconciliationRuns.eventId, batch.eventId),
              isNull(partnerReconciliationRuns.eventId),
            ),
            or(
              eq(partnerReconciliationRuns.batchId, batch.id),
              isNull(partnerReconciliationRuns.batchId),
            ),
          ),
        )
        .limit(1);
      if (unresolvedReconciliation) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '当前批次存在未关闭的出款对账差异，暂不能执行微信转账',
          HttpStatus.CONFLICT,
        );
      }
      const rows = await tx
        .select({ request: partnerPayoutRequests, recipient: partnerPayoutRecipients })
        .from(partnerPayoutRequests)
        .innerJoin(
          partnerPayoutRecipients,
          eq(partnerPayoutRecipients.id, partnerPayoutRequests.recipientId),
        )
        .where(
          and(
            eq(partnerPayoutRequests.batchId, batch.id),
            eq(partnerPayoutRequests.status, 'batched'),
            eq(partnerPayoutRecipients.status, 'verified'),
            eq(partnerPayoutRecipients.channel, 'wechat_transfer'),
            sql`not exists (
              select 1 from partner_ledger_entries recovery
              where recovery.partner_id = ${partnerPayoutRequests.partnerId}
                and recovery.balance_bucket = 'recovery_due'
              group by recovery.partner_id
              having sum(recovery.amount) > 0
            )`,
          ),
        );
      if (rows.length !== batch.requestCount) {
        throw new DomainError(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '出款批次中存在不可执行的申请或收款人',
          HttpStatus.CONFLICT,
        );
      }
      const partnerIds = [...new Set(rows.map((row) => row.request.partnerId))].sort();
      for (const partnerId of partnerIds) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`partner-balance:${partnerId}`}, 0))`,
        );
      }
      if (partnerIds.length) {
        const [blockedPartner] = await tx
          .select({ partnerId: partnerLedgerEntries.partnerId })
          .from(partnerLedgerEntries)
          .where(
            and(
              inArray(partnerLedgerEntries.partnerId, partnerIds),
              eq(partnerLedgerEntries.balanceBucket, 'recovery_due'),
            ),
          )
          .groupBy(partnerLedgerEntries.partnerId)
          .having(sql`sum(${partnerLedgerEntries.amount}) > 0`)
          .limit(1);
        if (blockedPartner) {
          throw new DomainError(
            API_ERROR_CODES.INVALID_STATE_TRANSITION,
            '出款批次中存在新增待追偿金额，请重新组批',
            HttpStatus.CONFLICT,
          );
        }
      }
      const dayStart = startOfShanghaiDay();
      const monthStart = startOfShanghaiMonth();
      const merchantDay = await tx
        .select({ value: sum(partnerPayoutExecutions.amount) })
        .from(partnerPayoutExecutions)
        .where(
          and(
            eq(partnerPayoutExecutions.organizationId, organizationId),
            gte(partnerPayoutExecutions.createdAt, dayStart),
            inArray(partnerPayoutExecutions.status, [...ACTIVE_EXECUTION_STATES]),
          ),
        );
      const merchantMonth = await tx
        .select({ value: sum(partnerPayoutExecutions.amount) })
        .from(partnerPayoutExecutions)
        .where(
          and(
            eq(partnerPayoutExecutions.organizationId, organizationId),
            gte(partnerPayoutExecutions.createdAt, monthStart),
            inArray(partnerPayoutExecutions.status, [...ACTIVE_EXECUTION_STATES]),
          ),
        );
      let runningDay = Number(merchantDay[0]?.value ?? 0);
      let runningMonth = Number(merchantMonth[0]?.value ?? 0);
      const executions: Array<{
        execution: typeof partnerPayoutExecutions.$inferSelect;
        openid: string;
        displayName: string;
      }> = [];
      for (const row of rows) {
        const [userDay] = await tx
          .select({ value: sum(partnerPayoutExecutions.amount) })
          .from(partnerPayoutExecutions)
          .innerJoin(
            partnerPayoutRequests,
            eq(partnerPayoutRequests.id, partnerPayoutExecutions.payoutRequestId),
          )
          .innerJoin(
            partnerPayoutRecipients,
            eq(partnerPayoutRecipients.id, partnerPayoutRequests.recipientId),
          )
          .where(
            and(
              eq(partnerPayoutExecutions.organizationId, organizationId),
              eq(partnerPayoutRecipients.accountFingerprint, row.recipient.accountFingerprint),
              gte(partnerPayoutExecutions.createdAt, dayStart),
              inArray(partnerPayoutExecutions.status, [...ACTIVE_EXECUTION_STATES]),
            ),
          );
        if (
          exceedsMerchantTransferLimit({
            amount: row.request.netAmount,
            userDayAmount: Number(userDay?.value ?? 0),
            merchantDayAmount: runningDay,
            merchantMonthAmount: runningMonth,
            perTransferLimit: integration.transferConfig.singleTransferLimit,
            perUserDayLimit: integration.transferConfig.dailyUserLimit,
            merchantDayLimit: integration.transferConfig.dailyMerchantLimit,
            merchantMonthLimit: integration.transferConfig.monthlyMerchantLimit,
          })
        ) {
          throw new DomainError(
            API_ERROR_CODES.INVALID_STATE_TRANSITION,
            '出款批次超出当前商户或收款人额度，请排队到下一批或改用人工结算',
            HttpStatus.CONFLICT,
          );
        }
        const openid = openSecret(
          row.recipient.openIdCiphertext ?? row.recipient.accountReferenceCiphertext,
          payoutDataSecret(),
        );
        const displayName = openSecret(row.recipient.displayNameCiphertext, payoutDataSecret());
        const billNo = merchantBillNo();
        const requestSnapshot = {
          appid: integration.config.appId,
          out_bill_no: billNo,
          transfer_scene_id: integration.transferConfig.sceneId,
          openidFingerprint: row.recipient.accountFingerprint,
          transfer_amount: row.request.netAmount,
          transfer_remark: integration.transferConfig.remunerationDescription,
          notify_url: this.notifyUrl(organizationId),
          transfer_scene_report_infos: [
            { info_type: '岗位类型', info_content: integration.transferConfig.jobType },
            {
              info_type: '报酬说明',
              info_content: integration.transferConfig.remunerationDescription,
            },
          ],
        };
        const [execution] = await tx
          .insert(partnerPayoutExecutions)
          .values({
            organizationId,
            eventId: row.request.eventId,
            partnerId: row.request.partnerId,
            payoutRequestId: row.request.id,
            batchId: batch.id,
            channel: 'wechat_transfer',
            status: 'prepared',
            sceneId: integration.transferConfig.sceneId,
            jobType: integration.transferConfig.jobType,
            remunerationDescription: integration.transferConfig.remunerationDescription,
            amount: row.request.netAmount,
            recipientVersion: row.recipient.version,
            merchantBillNo: billNo,
            integrationRevision: integration.row.revision,
            credentialVersion: integration.row.keyVersion,
            recipientSnapshot: {
              recipientId: row.recipient.id,
              recipientVersion: row.recipient.version,
              appId: row.recipient.appId ?? integration.config.appId,
              accountFingerprint: row.recipient.accountFingerprint,
              displayNameCiphertext: row.recipient.displayNameCiphertext,
              openIdCiphertext:
                row.recipient.openIdCiphertext ?? row.recipient.accountReferenceCiphertext,
            },
            requestSnapshot,
          })
          .returning();
        executions.push({ execution: execution!, openid, displayName });
        runningDay += row.request.netAmount;
        runningMonth += row.request.netAmount;
        await tx
          .update(partnerPayoutRequests)
          .set({
            status: 'executing',
            version: sql`${partnerPayoutRequests.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(partnerPayoutRequests.id, row.request.id));
      }
      await tx
        .update(partnerPayoutBatches)
        .set({
          status: 'executing',
          merchantId: integration.config.mchId,
          version: batch.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(partnerPayoutBatches.id, batch.id));
      await tx.insert(auditLogs).values({
        organizationId,
        eventId,
        actorId,
        actorType: 'staff',
        action: 'partner.payout_batch.execution_started',
        resourceType: 'partner_payout_batch',
        resourceId: batch.id,
        before: { status: batch.status, version: batch.version },
        after: {
          status: 'executing',
          executionCount: executions.length,
          merchantId: integration.config.mchId,
          integrationRevision: integration.row.revision,
        },
        traceId: randomUUID(),
      });
      return executions;
    });

    const results = [];
    for (const preparedExecution of prepared) {
      const { execution, openid, displayName } = preparedExecution;
      const body = {
        appid: integration.config.appId,
        out_bill_no: execution.merchantBillNo,
        transfer_scene_id: execution.sceneId,
        openid,
        ...(execution.amount >= 200_000
          ? {
              user_name: this.encryptedName(displayName, integration.credentials.platformPublicKey),
            }
          : {}),
        transfer_amount: execution.amount,
        transfer_remark: execution.remunerationDescription,
        notify_url: this.notifyUrl(organizationId),
        transfer_scene_report_infos: [
          { info_type: '岗位类型', info_content: execution.jobType },
          { info_type: '报酬说明', info_content: execution.remunerationDescription },
        ],
      };
      const response = await this.request(
        'POST',
        '/v3/fund-app/mch-transfer/transfer-bills',
        body,
        integration.config,
        integration.credentials,
      );
      const parsedState = MerchantTransferStateSchema.safeParse(response.body.state);
      const state = response.known && parsedState.success ? parsedState.data : 'unknown';
      results.push(await this.applyState(execution.id, state, response.body));
    }
    return { batchId, items: results };
  }

  async queryExecution(
    organizationId: string,
    eventId: number,
    executionId: string,
    expectedVersion?: number,
  ) {
    const [execution] = await this.db()
      .select()
      .from(partnerPayoutExecutions)
      .where(
        and(
          eq(partnerPayoutExecutions.id, executionId),
          eq(partnerPayoutExecutions.organizationId, organizationId),
          eq(partnerPayoutExecutions.eventId, eventId),
          eq(partnerPayoutExecutions.channel, 'wechat_transfer'),
        ),
      )
      .limit(1);
    if (!execution || !execution.merchantBillNo) {
      throw new DomainError(
        API_ERROR_CODES.NOT_FOUND,
        '微信转账执行记录不存在',
        HttpStatus.NOT_FOUND,
      );
    }
    if (expectedVersion && execution.version !== expectedVersion) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '转账状态已更新，请刷新后重试',
        HttpStatus.CONFLICT,
      );
    }
    const integration = await this.integration(organizationId);
    const response = await this.request(
      'GET',
      `/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/${encodeURIComponent(execution.merchantBillNo)}`,
      undefined,
      integration.config,
      integration.credentials,
    );
    const parsedState = MerchantTransferStateSchema.safeParse(response.body.state);
    return this.applyState(
      execution.id,
      response.known && parsedState.success ? parsedState.data : 'unknown',
      response.body,
    );
  }

  async customerConfirmation(session: AuthenticatedCustomer, eventId: number, requestId: string) {
    const [row] = await this.db()
      .select({ execution: partnerPayoutExecutions, request: partnerPayoutRequests })
      .from(partnerPayoutExecutions)
      .innerJoin(
        partnerPayoutRequests,
        eq(partnerPayoutRequests.id, partnerPayoutExecutions.payoutRequestId),
      )
      .where(
        and(
          eq(partnerPayoutRequests.id, requestId),
          eq(partnerPayoutRequests.eventId, eventId),
          eq(partnerPayoutRequests.organizationId, session.organizationId),
          sql`exists (select 1 from event_partners ep where ep.id = ${partnerPayoutRequests.partnerId} and ep.customer_user_id = ${session.customerUserId})`,
        ),
      )
      .limit(1);
    if (
      !row ||
      row.execution.status !== 'WAIT_USER_CONFIRM' ||
      !row.execution.confirmationPackage ||
      (row.execution.confirmationExpiresAt && row.execution.confirmationExpiresAt <= new Date())
    ) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '当前提现无需微信用户确认',
        HttpStatus.CONFLICT,
      );
    }
    const integration = await this.integration(session.organizationId);
    return {
      mchId: integration.config.mchId,
      appId: integration.config.appId,
      package: row.execution.confirmationPackage,
      expiresAt: row.execution.confirmationExpiresAt?.toISOString() ?? null,
      executionVersion: row.execution.version,
      requestVersion: row.request.version,
    };
  }

  async markCustomerConfirmed(
    session: AuthenticatedCustomer,
    eventId: number,
    requestId: string,
    expectedVersion: number,
  ) {
    const [updated] = await this.db()
      .update(partnerPayoutRequests)
      .set({
        userConfirmedAt: new Date(),
        version: sql`${partnerPayoutRequests.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(partnerPayoutRequests.id, requestId),
          eq(partnerPayoutRequests.eventId, eventId),
          eq(partnerPayoutRequests.organizationId, session.organizationId),
          eq(partnerPayoutRequests.version, expectedVersion),
          eq(partnerPayoutRequests.status, 'executing'),
          sql`exists (select 1 from event_partners ep where ep.id = ${partnerPayoutRequests.partnerId} and ep.customer_user_id = ${session.customerUserId})`,
          sql`exists (
            select 1 from partner_payout_executions execution
            where execution.payout_request_id = ${partnerPayoutRequests.id}
              and execution.status = 'WAIT_USER_CONFIRM'
              and (
                execution.confirmation_expires_at is null
                or execution.confirmation_expires_at > now()
              )
          )`,
        ),
      )
      .returning();
    if (!updated) {
      throw new DomainError(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '提现状态已更新，请刷新后重试',
        HttpStatus.CONFLICT,
      );
    }
    return updated;
  }

  async receiveNotification(
    organizationId: string,
    rawBody: Buffer,
    headers: {
      timestamp?: string | undefined;
      nonce?: string | undefined;
      signature?: string | undefined;
      serial?: string | undefined;
    },
  ) {
    const integration = await this.integration(organizationId);
    this.verifySignedMessage(
      rawBody.toString('utf8'),
      headers,
      integration.config,
      integration.credentials,
    );
    let notification: WeChatNotification;
    let resource: WeChatTransferResponse & { mchid?: string };
    try {
      notification = JSON.parse(rawBody.toString('utf8')) as WeChatNotification;
      if (
        typeof notification.id !== 'string' ||
        notification.id.length === 0 ||
        notification.id.length > 160 ||
        notification.event_type !== 'MCHTRANSFER.BILL.FINISHED' ||
        !notification.resource ||
        notification.resource.algorithm !== 'AEAD_AES_256_GCM'
      ) {
        throw new Error('invalid event');
      }
      const ciphertext = Buffer.from(notification.resource.ciphertext, 'base64');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(integration.credentials.apiV3Key, 'utf8'),
        Buffer.from(notification.resource.nonce, 'utf8'),
      );
      decipher.setAAD(Buffer.from(notification.resource.associated_data ?? '', 'utf8'));
      decipher.setAuthTag(ciphertext.subarray(-16));
      resource = JSON.parse(
        Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString(
          'utf8',
        ),
      ) as WeChatTransferResponse & { mchid?: string };
    } catch {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信转账通知内容无效',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (resource.mchid !== integration.config.mchId || !resource.out_bill_no) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信转账通知商户归属无效',
        HttpStatus.BAD_REQUEST,
      );
    }
    const state = MerchantTransferStateSchema.safeParse(resource.state);
    if (!state.success || !['SUCCESS', 'FAIL', 'CANCELLED'].includes(state.data)) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信转账通知终态无效',
        HttpStatus.BAD_REQUEST,
      );
    }
    const [execution] = await this.db()
      .select({
        id: partnerPayoutExecutions.id,
        eventId: partnerPayoutExecutions.eventId,
      })
      .from(partnerPayoutExecutions)
      .where(
        and(
          eq(partnerPayoutExecutions.organizationId, organizationId),
          eq(partnerPayoutExecutions.merchantBillNo, resource.out_bill_no),
        ),
      )
      .limit(1);
    if (!execution) {
      throw new DomainError(
        API_ERROR_CODES.NOT_FOUND,
        '微信转账通知未匹配本地记录',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.db()
      .insert(partnerFinancialEventInbox)
      .values({
        organizationId,
        eventId: execution.eventId,
        eventType: 'WechatTransferStateChanged',
        eventKey: `wechat-transfer-notification:${notification.id}`,
        payload: {
          executionId: execution.id,
          state: state.data,
          response: sanitizedTransferResponse(resource),
        },
      })
      .onConflictDoNothing();
  }

  async reconcileStaleExecutions(limit = 50) {
    const stale = await this.db()
      .select({
        id: partnerPayoutExecutions.id,
        organizationId: partnerPayoutExecutions.organizationId,
        eventId: partnerPayoutExecutions.eventId,
      })
      .from(partnerPayoutExecutions)
      .where(
        and(
          eq(partnerPayoutExecutions.channel, 'wechat_transfer'),
          inArray(partnerPayoutExecutions.status, [
            'prepared',
            'ACCEPTED',
            'PROCESSING',
            'WAIT_USER_CONFIRM',
            'TRANSFERING',
            'CANCELING',
            'unknown',
          ]),
          lt(partnerPayoutExecutions.updatedAt, new Date(Date.now() - 5 * 60_000)),
        ),
      )
      .limit(limit);
    for (const execution of stale) {
      await this.queryExecution(execution.organizationId, execution.eventId, execution.id).catch(
        () => undefined,
      );
    }
    return { checked: stale.length };
  }
}
