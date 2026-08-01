import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  API_ERROR_CODES,
  CheckInRequestSchema,
  CreateRegistrationSchema,
  PaymentCallbackSchema,
  WaitlistJoinSchema,
} from '@conference/contracts';
import { isReadableTicketCode } from '@conference/security';
import { ConferenceRepository } from '../common/conference.repository.js';
import { DomainError } from '../common/domain-error.js';
import { AuthGuard, RequireGrant, type AuthenticatedUser } from '../common/auth.guard.js';
import { OrganizationAdminService } from '../common/organization-admin.service.js';
import { TemplateOperationsService } from '../common/template-operations.service.js';
import { WeChatPayService } from '../common/wechat-pay.service.js';
import { CustomerAuthService } from '../common/customer-auth.service.js';
import { HtmlTemplateOperationsService } from '../common/html-template-operations.service.js';

function idempotencyKey(value: string | undefined) {
  if (!value || value.length < 8 || value.length > 160) {
    throw new DomainError(
      API_ERROR_CODES.VALIDATION_ERROR,
      '写操作需要 8 到 160 字符的 Idempotency-Key',
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

function orderAccessToken(authorization: string | undefined) {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (token.length < 32 || token.length > 500) {
    throw new DomainError(
      API_ERROR_CODES.UNAUTHORIZED,
      '订单访问链接无效或已经过期',
      HttpStatus.UNAUTHORIZED,
    );
  }
  return token;
}

function verifyPaymentSignature(
  provider: string,
  body: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
) {
  const providerKey = `PAYMENT_WEBHOOK_SECRET_${provider.toUpperCase().replaceAll('-', '_')}`;
  const secret =
    process.env[providerKey] ??
    process.env.PAYMENT_WEBHOOK_SECRET ??
    (process.env.NODE_ENV === 'production' ? undefined : 'conference-webhook-development-secret');
  if (
    !secret ||
    (process.env.NODE_ENV === 'production' &&
      [
        'conference-webhook-development-secret',
        'conference-local-payment-webhook-secret-2026',
        'replace-with-a-random-provider-webhook-secret',
      ].includes(secret))
  ) {
    throw new DomainError(
      API_ERROR_CODES.INVALID_STATE_TRANSITION,
      '支付回调密钥尚未配置',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  const timestampValue = Number(timestamp);
  if (
    !timestamp ||
    !Number.isFinite(timestampValue) ||
    Math.abs(Date.now() - timestampValue) > 5 * 60_000
  ) {
    throw new DomainError(
      API_ERROR_CODES.UNAUTHORIZED,
      '支付回调时间戳无效或已经过期',
      HttpStatus.UNAUTHORIZED,
    );
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  const receivedBuffer = Buffer.from(signature ?? '', 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    throw new DomainError(
      API_ERROR_CODES.UNAUTHORIZED,
      '支付回调签名校验失败',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

@ApiTags('public-events')
@Controller('events')
class EventsController {
  constructor(
    @Inject(ConferenceRepository) private readonly repository: ConferenceRepository,
    @Inject(HtmlTemplateOperationsService)
    private readonly htmlTemplates: HtmlTemplateOperationsService,
  ) {}

  @Get(':slug/home-document')
  async getHomeDocument(
    @Param('slug') slug: string,
    @Headers('x-organization-slug') organizationSlugValue: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const organizationSlug =
      organizationSlugValue ?? process.env.PUBLIC_ORGANIZATION_SLUG ?? 'tokems-demo';
    try {
      const document = await this.htmlTemplates.renderPublishedHome(slug, organizationSlug);
      if (!document) {
        return reply
          .code(HttpStatus.NO_CONTENT)
          .header('Cache-Control', 'public, max-age=30')
          .header('Vary', 'X-Organization-Slug, Accept-Encoding')
          .send();
      }
      if (ifNoneMatch && ifNoneMatch === document.etag) {
        return reply
          .code(HttpStatus.NOT_MODIFIED)
          .header('ETag', document.etag)
          .header('Vary', 'X-Organization-Slug, Accept-Encoding')
          .send();
      }
      return reply
        .type('text/html; charset=utf-8')
        .header('Content-Security-Policy', document.csp)
        .header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
        .header('ETag', document.etag)
        .header('Vary', 'X-Organization-Slug, Accept-Encoding')
        .header('Referrer-Policy', 'strict-origin-when-cross-origin')
        .header('X-Content-Type-Options', 'nosniff')
        .header(
          'Permissions-Policy',
          'camera=(), microphone=(), geolocation=(), usb=(), bluetooth=()',
        )
        .send(document.html);
    } catch (error) {
      if (error instanceof DomainError && error.getStatus() === HttpStatus.NOT_FOUND) throw error;
      const artifact = await this.htmlTemplates.renderPublishedArtifactFallback(
        slug,
        organizationSlug,
      );
      if (artifact) {
        if (ifNoneMatch && ifNoneMatch === artifact.etag) {
          return reply
            .code(HttpStatus.NOT_MODIFIED)
            .header('ETag', artifact.etag)
            .header('Vary', 'X-Organization-Slug, Accept-Encoding')
            .send();
        }
        return reply
          .type('text/html; charset=utf-8')
          .header('Content-Security-Policy', artifact.csp)
          .header('Cache-Control', 'public, max-age=15, stale-while-revalidate=120')
          .header('ETag', artifact.etag)
          .header('Vary', 'X-Organization-Slug, Accept-Encoding')
          .header('Referrer-Policy', 'strict-origin-when-cross-origin')
          .header('X-Content-Type-Options', 'nosniff')
          .header('Warning', '110 - "Response served from release artifact"')
          .send(artifact.html);
      }
      const event = await this.repository.getPublicEvent(slug, organizationSlug);
      const escape = (value: string) =>
        value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const fallback = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(event.name)}</title></head><body><main><h1>${escape(event.name)}</h1><p>${escape(event.startsAt)} · ${escape(event.venue)}</p><p>页面正在恢复，请稍后刷新。</p><a href="/register">进入报名</a></main></body></html>`;
      return reply
        .code(HttpStatus.SERVICE_UNAVAILABLE)
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .header(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'",
        )
        .send(fallback);
    }
  }

  @Get(':slug')
  async getEvent(
    @Param('slug') slug: string,
    @Headers('x-organization-slug') organizationSlug?: string,
  ) {
    const event = await this.repository.getPublicEvent(
      slug,
      organizationSlug ?? process.env.PUBLIC_ORGANIZATION_SLUG ?? 'tokems-demo',
    );
    if (['draft', 'configuring', 'archived'].includes(event.status)) {
      throw new DomainError(
        API_ERROR_CODES.NOT_FOUND,
        '大会不存在或尚未发布',
        HttpStatus.NOT_FOUND,
      );
    }
    return event;
  }
}

@ApiTags('public-site')
@Controller('site-config')
class SiteConfigurationController {
  constructor(
    @Inject(OrganizationAdminService)
    private readonly organizationAdmin: OrganizationAdminService,
  ) {}

  @Get()
  getConfiguration(@Headers('x-organization-slug') organizationSlug?: string) {
    return this.organizationAdmin.getPublicSiteConfiguration(
      organizationSlug ?? process.env.PUBLIC_ORGANIZATION_SLUG ?? 'tokems-demo',
    );
  }
}

@ApiTags('public-template-assets')
@Controller('assets/templates')
class TemplateAssetsController {
  constructor(
    @Inject(TemplateOperationsService)
    private readonly templates: TemplateOperationsService,
  ) {}

  @Get(':assetId')
  async asset(@Param('assetId') assetId: string, @Res() reply: FastifyReply) {
    const url = await this.templates.publicAssetUrl(assetId);
    return reply.code(HttpStatus.FOUND).redirect(url);
  }
}

@ApiTags('registrations')
@Controller('registrations')
class RegistrationsController {
  constructor(
    @Inject(ConferenceRepository) private readonly repository: ConferenceRepository,
    @Inject(CustomerAuthService) private readonly customerAuth: CustomerAuthService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = CreateRegistrationSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '报名信息校验失败，请检查必填项',
        HttpStatus.BAD_REQUEST,
        { issues: parsed.error.issues },
      );
    }
    const session = await this.customerAuth.optionalSession(request);
    return this.repository.createCheckout(
      parsed.data,
      idempotencyKey(key),
      session
        ? {
            customerUserId: session.customerUserId,
            organizationId: session.organizationId,
            mobile: session.customer.mobile,
            profile: session.customer.profile,
          }
        : undefined,
    );
  }
}

@ApiTags('waitlist')
@Controller('waitlist')
class WaitlistController {
  constructor(
    @Inject(ConferenceRepository) private readonly repository: ConferenceRepository,
    @Inject(CustomerAuthService) private readonly customerAuth: CustomerAuthService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async join(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') key?: string,
  ) {
    const parsed = WaitlistJoinSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '候补信息校验失败，请检查姓名和邮箱',
        HttpStatus.BAD_REQUEST,
        { issues: parsed.error.issues },
      );
    }
    const session = await this.customerAuth.optionalSession(request);
    return this.repository.joinWaitlist(
      parsed.data,
      idempotencyKey(key),
      session
        ? {
            customerUserId: session.customerUserId,
            organizationId: session.organizationId,
            mobile: session.customer.mobile,
            profile: session.customer.profile,
          }
        : undefined,
    );
  }
}

@ApiTags('orders-and-tickets')
@Controller()
class OrdersController {
  constructor(
    @Inject(ConferenceRepository) private readonly repository: ConferenceRepository,
    @Inject(WeChatPayService) private readonly weChatPay: WeChatPayService,
  ) {}

  @Get('orders/:identifier')
  async getOrder(
    @Param('identifier') identifier: string,
    @Headers('authorization') authorization?: string,
  ) {
    const accessToken = orderAccessToken(authorization);
    const current = await this.repository.getOrder(identifier, accessToken);
    if (['pending_payment', 'processing'].includes(current.status) && current.paymentUrl) {
      try {
        const transaction = await this.weChatPay.queryNativePayment(current.id, accessToken);
        if (transaction) {
          await this.repository.confirmPayment(
            transaction.orderId,
            `wechatpay:query:${transaction.externalId}`,
            {
              provider: 'wechatpay',
              externalId: transaction.externalId,
              amount: transaction.amount,
              currency: transaction.currency,
              occurredAt: transaction.occurredAt,
              payload: {
                source: 'transaction-query',
                occurredAt: transaction.occurredAt,
                receivedAt: new Date().toISOString(),
              },
              reason: '微信支付主动查单确认成功',
            },
          );
          return this.repository.getOrder(identifier, accessToken);
        }
      } catch {
        // 回调仍是主确认路径；查单暂时失败时继续返回本地订单供用户重试。
      }
    }
    return current;
  }

  @Get('orders/:identifier/ticket')
  getOrderTicket(
    @Param('identifier') identifier: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.repository.getOrderTicket(identifier, orderAccessToken(authorization));
  }

  @Post('payments/mock/:orderId/confirm')
  @HttpCode(HttpStatus.OK)
  confirmMockPayment(@Param('orderId') orderId: string, @Headers('idempotency-key') key?: string) {
    const localSimulationEnabled = process.env.ENABLE_LOCAL_PAYMENT_SIMULATION === 'true';
    if (process.env.NODE_ENV === 'production' || !localSimulationEnabled) {
      throw new DomainError(
        API_ERROR_CODES.FORBIDDEN,
        '当前环境未启用模拟支付确认',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.repository.confirmMockPayment(orderId, idempotencyKey(key));
  }

  @Post('payments/wechat/:orderId/native')
  @HttpCode(HttpStatus.OK)
  prepareWeChatNativePayment(
    @Param('orderId') orderId: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.weChatPay.prepareNativePayment(orderId, orderAccessToken(authorization));
  }

  @Post('payments/wechat/notify/:organizationId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async weChatPaymentNotification(
    @Param('organizationId') organizationId: string,
    @Req() request: FastifyRequest & { rawBody?: Buffer },
    @Headers('wechatpay-timestamp') timestamp?: string,
    @Headers('wechatpay-nonce') nonce?: string,
    @Headers('wechatpay-signature') signature?: string,
    @Headers('wechatpay-serial') serial?: string,
  ) {
    if (!request.rawBody) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信支付回调缺少原始请求内容',
        HttpStatus.BAD_REQUEST,
      );
    }
    const transaction = await this.weChatPay.parseNotification(organizationId, request.rawBody, {
      timestamp,
      nonce,
      signature,
      serial,
    });
    await this.repository.confirmPayment(
      transaction.orderId,
      `wechatpay:${transaction.externalId}`,
      {
        provider: 'wechatpay',
        externalId: transaction.externalId,
        amount: transaction.amount,
        currency: transaction.currency,
        occurredAt: transaction.occurredAt,
        payload: {
          notificationId: transaction.notificationId,
          occurredAt: transaction.occurredAt,
          receivedAt: new Date().toISOString(),
        },
        reason: '微信支付回调确认成功',
      },
    );
    return { code: 'SUCCESS', message: '成功' };
  }

  @Post('payments/webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  paymentWebhook(
    @Param('provider') provider: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { rawBody?: Buffer },
    @Headers('x-payment-timestamp') timestamp?: string,
    @Headers('x-payment-signature') signature?: string,
  ) {
    if (!/^[a-z0-9-]{2,40}$/.test(provider)) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '支付渠道标识格式不正确',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (provider === 'wechatpay') {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信支付必须使用专用的签名回调地址',
        HttpStatus.BAD_REQUEST,
      );
    }
    const parsed = PaymentCallbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '支付回调内容校验失败',
        HttpStatus.BAD_REQUEST,
        { issues: parsed.error.issues },
      );
    }
    verifyPaymentSignature(
      provider,
      request.rawBody ?? Buffer.from(JSON.stringify(body)),
      timestamp,
      signature,
    );
    return this.repository.confirmPayment(
      parsed.data.orderId,
      `payment:${provider}:${parsed.data.externalId}`,
      {
        provider,
        externalId: parsed.data.externalId,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        occurredAt: parsed.data.occurredAt,
        payload: {
          status: parsed.data.status,
          occurredAt: parsed.data.occurredAt,
          receivedAt: new Date().toISOString(),
        },
        reason: `${provider} 支付回调确认成功`,
      },
    );
  }

  @Get('tickets/:code')
  getTicket(@Param('code') code: string) {
    if (!isReadableTicketCode(code)) {
      throw new DomainError(API_ERROR_CODES.NOT_FOUND, '电子票尚未签发', HttpStatus.NOT_FOUND);
    }
    return this.repository.getTicket(code);
  }
}

@ApiTags('checkin')
@UseGuards(AuthGuard)
@Controller('checkins')
class CheckInController {
  constructor(@Inject(ConferenceRepository) private readonly repository: ConferenceRepository) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireGrant('event.checkin.execute')
  checkIn(@Body() body: unknown, @Req() request: FastifyRequest & { user: AuthenticatedUser }) {
    const parsed = CheckInRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError(
        API_ERROR_CODES.VALIDATION_ERROR,
        '核销参数校验失败',
        HttpStatus.BAD_REQUEST,
        { issues: parsed.error.issues },
      );
    }
    return this.repository.checkIn(parsed.data, request.user.organizationId);
  }
}

@Module({
  controllers: [
    EventsController,
    SiteConfigurationController,
    TemplateAssetsController,
    RegistrationsController,
    WaitlistController,
    OrdersController,
    CheckInController,
  ],
})
export class PublicModule {}
