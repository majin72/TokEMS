import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  API_ERROR_CODES,
  DEFAULT_PARTNER_POSTER_FIELDS,
  DEFAULT_PARTNER_VISIBLE_FIELDS,
  PUBLIC_EVENT_STATUSES,
  PartnerProgramDraftSchema,
  PartnerTransferConfigurationSchema,
  calculateCommissionLine,
  publicEventScopedPath,
  type AdminEnablePartner,
  type AdminUpdatePartner,
  type PartnerProgramDraft,
  type PartnerTransferConfiguration,
  type PublishPartnerProgram,
  type UpdatePartnerPrivacy,
  type UpdatePartnerProfile,
} from '@conference/contracts';
import {
  auditLogs,
  customerMediaAssets,
  customerProfiles,
  customerUsers,
  eventPartnerProfileVersions,
  eventPartnerProgramVersions,
  eventPartnerRuleAcceptances,
  eventPartners,
  events,
  notificationDeliveries,
  organizationIntegrations,
  organizations,
  outboxEvents,
  partnerCommissionInquiries,
  partnerCommissions,
  partnerLedgerEntries,
  partnerPayoutBatches,
  partnerPayoutDocuments,
  partnerPayoutExecutions,
  partnerPayoutRecipients,
  partnerPayoutRequests,
  partnerReferralLinks,
  partnerReferralVisitDays,
  partnerReconciliationRuns,
  publicUserIds,
} from '@conference/database';
import { sealSecret } from '@conference/security';
import { and, asc, count, desc, eq, inArray, isNull, or, sql, sum } from 'drizzle-orm';
import type { AuthenticatedCustomer } from './customer-auth.service.js';
import { DatabaseService } from './database.service.js';
import { DomainError } from './domain-error.js';
import { matchesDeclaredMediaType, readUploadWithinLimit } from './object-storage-verification.js';
import { RedisService } from './redis.service.js';

export const PARTNER_REFERRAL_COOKIE = 'tokems_partner_referral';
export const PARTNER_REFERRAL_COOKIE_SECONDS = 30 * 24 * 60 * 60;

type ProfileRow = typeof eventPartnerProfileVersions.$inferSelect;
type ProgramRow = typeof eventPartnerProgramVersions.$inferSelect;

function fail(code: string, message: string, status = HttpStatus.CONFLICT): never {
  throw new DomainError(code, message, status);
}

function asIso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function normalizedProgram(input: PartnerProgramDraft) {
  return {
    ...input,
    tiers: [...input.tiers].sort((left, right) => left.minimumOrderCount - right.minimumOrderCount),
    eligibleTicketTypeIds: [...new Set(input.eligibleTicketTypeIds)].sort(),
  };
}

function programHash(input: PartnerProgramDraft) {
  return createHash('sha256').update(JSON.stringify(normalizedProgram(input))).digest('hex');
}

function unresolvedPayoutReconciliation(
  organizationId: string,
  eventId: number,
  batchId?: string,
) {
  return and(
    eq(partnerReconciliationRuns.organizationId, organizationId),
    eq(partnerReconciliationRuns.kind, 'payouts'),
    inArray(partnerReconciliationRuns.status, ['running', 'difference', 'failed']),
    or(eq(partnerReconciliationRuns.eventId, eventId), isNull(partnerReconciliationRuns.eventId)),
    batchId
      ? or(eq(partnerReconciliationRuns.batchId, batchId), isNull(partnerReconciliationRuns.batchId))
      : undefined,
  );
}

function serializeProgram(program: ProgramRow | undefined | null) {
  if (!program) return null;
  return {
    id: program.id,
    version: program.version,
    status: program.status,
    mode: program.mode,
    fixedRateBps: program.fixedRateBps,
    tiers: program.tiers,
    eligibleTicketTypeIds: program.eligibleTicketTypeIds,
    attributionDays: program.attributionDays,
    settlementDelayDays: program.settlementDelayDays,
    minimumPayoutAmount: program.minimumPayoutAmount,
    payoutCadence: program.payoutCadence,
    termsTitle: program.termsTitle,
    termsContent: program.termsContent,
    promotionPolicy: program.promotionPolicy,
    publicDirectoryEnabled: program.publicDirectoryEnabled,
    homepageLimit: program.homepageLimit,
    contentHash: program.contentHash,
    effectiveAt: asIso(program.effectiveAt),
    createdAt: program.createdAt.toISOString(),
  };
}

function profileAvatarUrl(eventSlug: string, publicSlug: string, profile: ProfileRow) {
  return profile.visibleFields.avatar && profile.avatarAssetId
    ? `/api/v1/events/${encodeURIComponent(eventSlug)}/partners/${encodeURIComponent(publicSlug)}/avatar`
    : null;
}

function serializeProfile(eventId: number, profile: ProfileRow) {
  const mediaUrl = (assetId: string) =>
    `/api/v1/customer/partnerships/${eventId}/media/${encodeURIComponent(assetId)}`;
  return {
    version: profile.version,
    displayName: profile.displayName,
    company: profile.company,
    title: profile.title,
    industry: profile.industry,
    businessIntro: profile.businessIntro,
    businessUrl: profile.businessUrl,
    contactPhone: profile.contactPhone,
    contactEmail: profile.contactEmail,
    wechatId: profile.wechatId,
    avatarUrl: profile.avatarAssetId ? mediaUrl(profile.avatarAssetId) : null,
    gallery: profile.gallery.map((item) => ({
      ...item,
      url: mediaUrl(item.assetId),
    })),
    publicStatus: profile.publicStatus,
    visibleFields: profile.visibleFields,
    posterFields: profile.posterFields,
    searchIndexingEnabled: profile.searchIndexingEnabled,
  };
}

function publicProfile(profile: ProfileRow, eventSlug: string, publicSlug: string) {
  const visible = profile.visibleFields;
  return {
    publicSlug,
    displayName: visible.displayName ? profile.displayName : '大会合作伙伴',
    company: visible.company ? profile.company : '',
    title: visible.title ? profile.title : '',
    industry: visible.industry ? profile.industry : '',
    businessIntro: visible.businessIntro ? profile.businessIntro : '',
    avatarUrl: visible.avatar ? profileAvatarUrl(eventSlug, publicSlug, profile) : null,
    searchIndexingEnabled: profile.searchIndexingEnabled,
    posterFields: profile.posterFields,
    ...(visible.businessUrl && profile.businessUrl ? { businessUrl: profile.businessUrl } : {}),
    ...(visible.contactPhone && profile.contactPhone ? { contactPhone: profile.contactPhone } : {}),
    ...(visible.contactEmail && profile.contactEmail ? { contactEmail: profile.contactEmail } : {}),
    ...(visible.wechatId && profile.wechatId ? { wechatId: profile.wechatId } : {}),
    gallery: visible.gallery
      ? profile.gallery.map((item) => ({
          url: `/api/v1/events/${encodeURIComponent(eventSlug)}/partners/${encodeURIComponent(publicSlug)}/media/${encodeURIComponent(item.assetId)}`,
          alt: item.alt,
        }))
      : [],
  };
}

function publicSummary(profile: ProfileRow, eventSlug: string, publicSlug: string) {
  const visible = profile.visibleFields;
  return {
    publicSlug,
    displayName: visible.displayName ? profile.displayName : '大会合作伙伴',
    company: visible.company ? profile.company : '',
    title: visible.title ? profile.title : '',
    industry: visible.industry ? profile.industry : '',
    businessIntro: visible.businessIntro ? profile.businessIntro : '',
    avatarUrl: visible.avatar ? profileAvatarUrl(eventSlug, publicSlug, profile) : null,
    searchIndexingEnabled: profile.searchIndexingEnabled,
  };
}

function referralSecret() {
  const value = process.env.PARTNER_ATTRIBUTION_SECRET ?? process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PARTNER_ATTRIBUTION_SECRET with at least 32 characters is required');
    }
    return 'tokems-partner-attribution-local-secret-2026';
  }
  return value;
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

export type PartnerReferralContext = {
  referralLinkId: string;
  partnerId: string;
  organizationId: string;
  eventId: number;
  expiresAt: string;
};

export function signPartnerReferralContext(context: PartnerReferralContext) {
  const encoded = Buffer.from(JSON.stringify(context), 'utf8').toString('base64url');
  const signature = createHmac('sha256', referralSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function readPartnerReferralContext(value: string | undefined) {
  if (!value) return null;
  const [encoded, suppliedSignature] = value.split('.');
  if (!encoded || !suppliedSignature) return null;
  const expected = createHmac('sha256', referralSecret()).update(encoded).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PartnerReferralContext;
    if (
      !parsed.referralLinkId ||
      !parsed.partnerId ||
      !parsed.organizationId ||
      !Number.isInteger(parsed.eventId) ||
      new Date(parsed.expiresAt).getTime() <= Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

type PayoutDocumentUploadToken = {
  organizationId: string;
  eventId: number;
  payoutRequestId: string;
  partnerId: string;
  kind: 'settlement_statement' | 'tax_document' | 'manual_receipt' | 'wechat_receipt';
  storageKey: string;
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png';
  size: number;
  contentDigest: string;
  actorId: string;
  expiresAt: string;
};

type PayoutDocumentDownloadToken = {
  organizationId: string;
  customerUserId: string;
  partnerId: string;
  documentId: string;
};

function signedPayoutDocumentToken(payload: PayoutDocumentUploadToken) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', payoutDataSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function readPayoutDocumentToken(value: string) {
  const [encoded, suppliedSignature] = value.split('.');
  if (!encoded || !suppliedSignature) return null;
  const expected = createHmac('sha256', payoutDataSecret()).update(encoded).digest();
  const supplied = Buffer.from(suppliedSignature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as PayoutDocumentUploadToken;
    return new Date(parsed.expiresAt).getTime() > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

function payoutObjectStorageUrl(
  storageKey: string,
  method: 'GET' | 'PUT',
  mediaType?: string,
  endpointOverride?: string,
  contentLength?: number,
) {
  const endpoint = endpointOverride ?? process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  if (!endpoint || !accessKey || !secretKey || !bucket) return null;
  const region = process.env.S3_REGION ?? 'us-east-1';
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/gu, '');
  const date = timestamp.slice(0, 8);
  const endpointUrl = new URL(endpoint);
  const encodedPath = storageKey.split('/').map(encodeURIComponent).join('/');
  const canonicalUri = `${endpointUrl.pathname.replace(/\/$/u, '')}/${encodeURIComponent(bucket)}/${encodedPath}`;
  const signedHeaders =
    method === 'PUT'
      ? contentLength
        ? 'content-length;content-type;host;if-none-match'
        : 'content-type;host;if-none-match'
      : 'host';
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${date}/${region}/s3/aws4_request`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': '600',
    'X-Amz-SignedHeaders': signedHeaders,
  });
  query.sort();
  const canonicalHeaders = `${contentLength ? `content-length:${contentLength}\n` : ''}${method === 'PUT' ? `content-type:${mediaType}\n` : ''}host:${endpointUrl.host}\n${method === 'PUT' ? 'if-none-match:*\n' : ''}`;
  const canonicalRequest = [
    method,
    canonicalUri,
    query.toString(),
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    `${date}/${region}/s3/aws4_request`,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const hmac = (key: Buffer | string, value: string) =>
    createHmac('sha256', key).update(value).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), 's3'), 'aws4_request');
  query.set('X-Amz-Signature', createHmac('sha256', signingKey).update(stringToSign).digest('hex'));
  return `${endpointUrl.origin}${canonicalUri}?${query.toString()}`;
}

@Injectable()
export class PartnerDistributionService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  private db() {
    if (!this.database.db) {
      fail(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '合作伙伴功能需要启用数据库后使用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.database.db!;
  }

  private async eventForOrganization(organizationId: string, eventId: number) {
    const [event] = await this.db()
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.organizationId, organizationId)))
      .limit(1);
    if (!event) fail(API_ERROR_CODES.NOT_FOUND, '大会不存在或无权访问', HttpStatus.NOT_FOUND);
    return event;
  }

  private async activeProgram(organizationId: string, eventId: number) {
    const [program] = await this.db()
      .select()
      .from(eventPartnerProgramVersions)
      .where(
        and(
          eq(eventPartnerProgramVersions.organizationId, organizationId),
          eq(eventPartnerProgramVersions.eventId, eventId),
          eq(eventPartnerProgramVersions.status, 'active'),
        ),
      )
      .orderBy(desc(eventPartnerProgramVersions.version))
      .limit(1);
    return program;
  }

  async ensureDefaultProgram(organizationId: string, eventId: number, actorId: string) {
    await this.eventForOrganization(organizationId, eventId);
    const existing = await this.activeProgram(organizationId, eventId);
    if (existing) return existing;
    const input = PartnerProgramDraftSchema.parse({
      termsTitle: '大会合作伙伴推广规则',
      termsContent:
        '合作伙伴应使用本人专属链接开展真实推广。佣金按成功付款且符合资格的订单明细计算，退款与自购会按规则冲正。',
      promotionPolicy:
        '推广内容应真实、清晰，不得承诺大会未公开的权益。发现误导宣传、异常流量或套取佣金时，大会可暂停归因与结算。',
    });
    const [created] = await this.db()
      .insert(eventPartnerProgramVersions)
      .values({
        organizationId,
        eventId,
        version: 1,
        status: 'active',
        ...normalizedProgram(input),
        contentHash: programHash(input),
        effectiveAt: new Date(),
        createdBy: actorId,
      })
      .onConflictDoNothing()
      .returning();
    return created ?? (await this.activeProgram(organizationId, eventId))!;
  }

  async publishProgram(
    organizationId: string,
    eventId: number,
    actorId: string,
    input: PublishPartnerProgram,
  ) {
    await this.eventForOrganization(organizationId, eventId);
    const db = this.db();
    return db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ version: eventPartnerProgramVersions.version })
        .from(eventPartnerProgramVersions)
        .where(
          and(
            eq(eventPartnerProgramVersions.organizationId, organizationId),
            eq(eventPartnerProgramVersions.eventId, eventId),
          ),
        )
        .orderBy(desc(eventPartnerProgramVersions.version))
        .limit(1);
      const { effectiveAt, ...draft } = input;
      const parsed = PartnerProgramDraftSchema.parse(draft);
      const startsAt = effectiveAt ? new Date(effectiveAt) : new Date();
      const status = startsAt.getTime() > Date.now() ? 'scheduled' : 'active';
      if (status === 'active') {
        await tx
          .update(eventPartnerProgramVersions)
          .set({ status: 'retired', updatedAt: new Date() })
          .where(
            and(
              eq(eventPartnerProgramVersions.organizationId, organizationId),
              eq(eventPartnerProgramVersions.eventId, eventId),
              eq(eventPartnerProgramVersions.status, 'active'),
            ),
          );
      }
      const [program] = await tx
        .insert(eventPartnerProgramVersions)
        .values({
          organizationId,
          eventId,
          version: (latest?.version ?? 0) + 1,
          status,
          ...normalizedProgram(parsed),
          contentHash: programHash(parsed),
          effectiveAt: startsAt,
          createdBy: actorId,
        })
        .returning();
      if (status === 'active') {
        await tx
          .update(eventPartners)
          .set({
            currentProgramVersionId: program!.id,
            qualificationStatus: 'pending_confirmation',
            attributionEnabled: false,
            version: sql`${eventPartners.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(eq(eventPartners.organizationId, organizationId), eq(eventPartners.eventId, eventId)),
          );
      }
      await tx.insert(auditLogs).values({
        organizationId,
        eventId,
        actorId,
        actorType: 'staff',
        action: 'partner.program.published',
        resourceType: 'event_partner_program_version',
        resourceId: program!.id,
        before: {},
        after: { version: program!.version, status },
        traceId: randomUUID(),
      });
      return serializeProgram(program!);
    });
  }

  async enablePartner(
    organizationId: string,
    eventId: number,
    actorId: string,
    input: AdminEnablePartner,
  ) {
    const event = await this.eventForOrganization(organizationId, eventId);
    const customerUserId =
      input.customerUserId ??
      (
        await this.db()
          .select({ id: publicUserIds.subjectUuid })
          .from(publicUserIds)
          .where(
            and(
              eq(publicUserIds.subjectType, 'customer'),
              eq(publicUserIds.publicId, input.customerPublicUserId!),
              isNull(publicUserIds.retiredAt),
            ),
          )
          .limit(1)
      )[0]?.id;
    if (!customerUserId) fail(API_ERROR_CODES.NOT_FOUND, '用户不存在或不属于当前组织', HttpStatus.NOT_FOUND);
    const program =
      (await this.activeProgram(organizationId, eventId)) ??
      (await this.ensureDefaultProgram(organizationId, eventId, actorId));
    const db = this.db();
    const result = await db.transaction(async (tx) => {
      const [customer] = await tx
        .select({ user: customerUsers, profile: customerProfiles })
        .from(customerUsers)
        .leftJoin(customerProfiles, eq(customerProfiles.customerUserId, customerUsers.id))
        .where(
          and(
            eq(customerUsers.id, customerUserId),
            eq(customerUsers.organizationId, organizationId),
            eq(customerUsers.status, 'active'),
          ),
        )
        .limit(1);
      if (!customer) fail(API_ERROR_CODES.NOT_FOUND, '用户不存在或不可开通', HttpStatus.NOT_FOUND);
      const [existing] = await tx
        .select()
        .from(eventPartners)
        .where(
          and(
            eq(eventPartners.organizationId, organizationId),
            eq(eventPartners.eventId, eventId),
            eq(eventPartners.customerUserId, customerUserId),
          ),
        )
        .limit(1);
      if (existing) return existing;
      const publicSlug = randomBytes(9).toString('base64url').toLowerCase();
      const [partner] = await tx
        .insert(eventPartners)
        .values({
          organizationId,
          eventId,
          customerUserId,
          publicSlug,
          currentProgramVersionId: program.id,
          personalRateBps: input.personalRateBps,
          sortOrder: input.sortOrder,
          internalNote: input.internalNote,
        })
        .returning();
      const displayName =
        customer.profile?.nickname || customer.profile?.realName || `合作伙伴 ${publicSlug.slice(0, 5)}`;
      await tx.insert(eventPartnerProfileVersions).values({
        partnerId: partner!.id,
        organizationId,
        eventId,
        version: 1,
        displayName,
        company: customer.profile?.company ?? '',
        title: customer.profile?.title ?? '',
        businessIntro: '',
        contactEmail: customer.profile?.email ?? '',
        contactPhone: customer.user.mobileE164,
        visibleFields: DEFAULT_PARTNER_VISIBLE_FIELDS,
        posterFields: DEFAULT_PARTNER_POSTER_FIELDS,
        actorType: 'staff',
        actorId,
      });
      await tx.insert(partnerReferralLinks).values({
        partnerId: partner!.id,
        organizationId,
        eventId,
        code: randomBytes(12).toString('base64url'),
        destinationPath: `/register?event=${encodeURIComponent(event.slug)}`,
      });
      await tx.insert(auditLogs).values({
        organizationId,
        eventId,
        actorId,
        actorType: 'staff',
        action: 'partner.enabled',
        resourceType: 'event_partner',
        resourceId: partner!.id,
        before: {},
        after: { customerUserId, programVersionId: program.id },
        traceId: randomUUID(),
      });
      if (input.sendInvitation) {
        const deliveryId = randomUUID();
        await tx.insert(notificationDeliveries).values({
          id: deliveryId,
          organizationId,
          eventId,
          channel: 'sms',
          recipient: customer.user.mobileE164,
          subject: `${event.name} 合作伙伴邀请`,
          body: `你的${event.name}合作伙伴权限已开通。请登录个人中心确认合作规则，随后即可使用专属推广链接。`,
          businessKey: `partner-invitation:${partner!.id}:${program.id}`,
          purpose: 'partner-invitation',
          recipientSource: 'partner-customer',
        });
        await tx.insert(outboxEvents).values({
          organizationId,
          eventId,
          eventType: 'NotificationRequested',
          correlationId: `partner-invitation:${partner!.id}:${program.id}`,
          payload: { deliveryId, partnerId: partner!.id, recipientRole: 'partner' },
        });
      }
      return partner!;
    });
    return this.relationship(result.id, result.customerUserId, organizationId);
  }

  async batchEnablePartners(
    organizationId: string,
    eventId: number,
    actorId: string,
    customerUserIds: string[],
    customerPublicUserIds: number[],
    personalRateBps: number | null,
    sendInvitation: boolean,
  ) {
    const items = [];
    for (const customerUserId of customerUserIds) {
      items.push(
        await this.enablePartner(organizationId, eventId, actorId, {
          customerUserId,
          personalRateBps,
          sortOrder: 0,
          internalNote: '',
          sendInvitation,
        }),
      );
    }
    for (const customerPublicUserId of customerPublicUserIds) {
      items.push(
        await this.enablePartner(organizationId, eventId, actorId, {
          customerPublicUserId,
          personalRateBps,
          sortOrder: 0,
          internalNote: '',
          sendInvitation,
        }),
      );
    }
    return { items, count: items.length };
  }

  async updatePartner(
    organizationId: string,
    eventId: number,
    partnerId: string,
    actorId: string,
    input: AdminUpdatePartner,
  ) {
    const [updated] = await this.db()
      .update(eventPartners)
      .set({
        ...(input.qualificationStatus ? { qualificationStatus: input.qualificationStatus } : {}),
        ...(input.attributionEnabled !== undefined
          ? { attributionEnabled: input.attributionEnabled }
          : {}),
        ...(input.settlementHold !== undefined ? { settlementHold: input.settlementHold } : {}),
        ...(input.settlementHoldReason !== undefined
          ? { settlementHoldReason: input.settlementHoldReason }
          : {}),
        ...(input.personalRateBps !== undefined ? { personalRateBps: input.personalRateBps } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.internalNote !== undefined ? { internalNote: input.internalNote } : {}),
        ...(input.qualificationStatus === 'active' ? { activatedAt: new Date() } : {}),
        ...(input.qualificationStatus === 'paused' ? { pausedAt: new Date() } : {}),
        ...(input.qualificationStatus === 'closed' ? { closedAt: new Date() } : {}),
        version: sql`${eventPartners.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventPartners.id, partnerId),
          eq(eventPartners.organizationId, organizationId),
          eq(eventPartners.eventId, eventId),
          eq(eventPartners.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!updated) fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '合作伙伴资料已更新，请刷新后重试');
    await this.db().insert(auditLogs).values({
      organizationId,
      eventId,
      actorId,
      actorType: 'staff',
      action: 'partner.updated',
      resourceType: 'event_partner',
      resourceId: partnerId,
      before: { expectedVersion: input.expectedVersion },
      after: input,
      traceId: randomUUID(),
    });
    return this.relationship(updated.id, updated.customerUserId, organizationId);
  }

  private async relationship(partnerId: string, customerUserId: string, organizationId: string) {
    const db = this.db();
    const [row] = await db
      .select({ partner: eventPartners, event: events, profile: eventPartnerProfileVersions })
      .from(eventPartners)
      .innerJoin(events, eq(events.id, eventPartners.eventId))
      .innerJoin(
        eventPartnerProfileVersions,
        and(
          eq(eventPartnerProfileVersions.partnerId, eventPartners.id),
          eq(eventPartnerProfileVersions.version, eventPartners.profileVersion),
        ),
      )
      .where(
        and(
          eq(eventPartners.id, partnerId),
          eq(eventPartners.customerUserId, customerUserId),
          eq(eventPartners.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴关系不存在', HttpStatus.NOT_FOUND);
    const [[program], [link], balanceRows] = await Promise.all([
      row.partner.currentProgramVersionId
        ? db
            .select()
            .from(eventPartnerProgramVersions)
            .where(eq(eventPartnerProgramVersions.id, row.partner.currentProgramVersionId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select()
        .from(partnerReferralLinks)
        .where(
          and(eq(partnerReferralLinks.partnerId, partnerId), eq(partnerReferralLinks.status, 'active')),
        )
        .limit(1),
      db
        .select({ bucket: partnerLedgerEntries.balanceBucket, value: sum(partnerLedgerEntries.amount) })
        .from(partnerLedgerEntries)
        .where(eq(partnerLedgerEntries.partnerId, partnerId))
        .groupBy(partnerLedgerEntries.balanceBucket),
    ]);
    const balances = Object.fromEntries(balanceRows.map((item) => [item.bucket, Number(item.value ?? 0)]));
    return {
      id: row.partner.id,
      eventId: row.event.id,
      eventSlug: row.event.slug,
      eventName: row.event.name,
      publicSlug: row.partner.publicSlug,
      referralCode: link?.code ?? '',
      referralPath: link ? `/r/${encodeURIComponent(link.code)}` : '',
      qualificationStatus: row.partner.qualificationStatus,
      attributionEnabled: row.partner.attributionEnabled,
      settlementHold: row.partner.settlementHold,
      currentProgram: serializeProgram(program),
      acceptedProgramVersionId: row.partner.acceptedProgramVersionId,
      personalRateBps: row.partner.personalRateBps,
      balances: {
        pending: balances.pending ?? 0,
        available: balances.available ?? 0,
        reserved: balances.reserved ?? 0,
        paid: balances.paid ?? 0,
        recoveryDue: balances.recovery_due ?? 0,
        currency: 'CNY' as const,
      },
      profile: serializeProfile(row.event.id, row.profile),
      version: row.partner.version,
    };
  }

  async accountPartnerships(session: AuthenticatedCustomer) {
    const rows = await this.db()
      .select({ id: eventPartners.id })
      .from(eventPartners)
      .where(
        and(
          eq(eventPartners.organizationId, session.organizationId),
          eq(eventPartners.customerUserId, session.customerUserId),
        ),
      )
      .orderBy(desc(eventPartners.createdAt));
    return {
      items: await Promise.all(
        rows.map((row) =>
          this.relationship(row.id, session.customerUserId, session.organizationId),
        ),
      ),
    };
  }

  async accountPartnership(session: AuthenticatedCustomer, eventId: number) {
    const [partner] = await this.db()
      .select({ id: eventPartners.id })
      .from(eventPartners)
      .where(
        and(
          eq(eventPartners.organizationId, session.organizationId),
          eq(eventPartners.customerUserId, session.customerUserId),
          eq(eventPartners.eventId, eventId),
        ),
      )
      .limit(1);
    if (!partner) fail(API_ERROR_CODES.NOT_FOUND, '本场大会尚未开通合作伙伴权限', HttpStatus.NOT_FOUND);
    return this.relationship(partner.id, session.customerUserId, session.organizationId);
  }

  async accountPartnerMediaScope(
    session: AuthenticatedCustomer,
    eventId: number,
    assetId: string,
  ) {
    const partner = await this.ownPartner(session, eventId);
    const [profile] = await this.db()
      .select({
        avatarAssetId: eventPartnerProfileVersions.avatarAssetId,
        gallery: eventPartnerProfileVersions.gallery,
      })
      .from(eventPartnerProfileVersions)
      .where(
        and(
          eq(eventPartnerProfileVersions.partnerId, partner.id),
          eq(eventPartnerProfileVersions.version, partner.profileVersion),
        ),
      )
      .limit(1);
    const allowed =
      profile?.avatarAssetId === assetId ||
      profile?.gallery.some((item) => item.assetId === assetId);
    if (!allowed) fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴图片不存在', HttpStatus.NOT_FOUND);
    return {
      organizationId: session.organizationId,
      customerUserId: session.customerUserId,
      assetId,
    };
  }

  private async ownPartner(session: AuthenticatedCustomer, eventId: number) {
    const [partner] = await this.db()
      .select()
      .from(eventPartners)
      .where(
        and(
          eq(eventPartners.organizationId, session.organizationId),
          eq(eventPartners.customerUserId, session.customerUserId),
          eq(eventPartners.eventId, eventId),
        ),
      )
      .limit(1);
    if (!partner) fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴关系不存在', HttpStatus.NOT_FOUND);
    return partner;
  }

  async acceptProgram(
    session: AuthenticatedCustomer,
    eventId: number,
    programVersionId: string,
    expectedPartnerVersion: number,
    requestIp: string,
    userAgent: string,
  ) {
    const partner = await this.ownPartner(session, eventId);
    if (partner.version !== expectedPartnerVersion) {
      fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '合作伙伴规则已更新，请刷新后确认');
    }
    const [program] = await this.db()
      .select()
      .from(eventPartnerProgramVersions)
      .where(
        and(
          eq(eventPartnerProgramVersions.id, programVersionId),
          eq(eventPartnerProgramVersions.organizationId, session.organizationId),
          eq(eventPartnerProgramVersions.eventId, eventId),
          eq(eventPartnerProgramVersions.status, 'active'),
        ),
      )
      .limit(1);
    if (!program) fail(API_ERROR_CODES.NOT_FOUND, '当前规则不存在或尚未生效', HttpStatus.NOT_FOUND);
    await this.db().transaction(async (tx) => {
      await tx
        .insert(eventPartnerRuleAcceptances)
        .values({
          partnerId: partner.id,
          organizationId: session.organizationId,
          eventId,
          programVersionId,
          customerUserId: session.customerUserId,
          termsContentHash: program.contentHash,
          requestIpHash: createHash('sha256').update(requestIp).digest('hex'),
          userAgentHash: createHash('sha256').update(userAgent).digest('hex'),
        })
        .onConflictDoNothing();
      const [updated] = await tx
        .update(eventPartners)
        .set({
          acceptedProgramVersionId: programVersionId,
          currentProgramVersionId: programVersionId,
          qualificationStatus: 'active',
          attributionEnabled: true,
          activatedAt: new Date(),
          version: sql`${eventPartners.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(eventPartners.id, partner.id), eq(eventPartners.version, expectedPartnerVersion)),
        )
        .returning({ id: eventPartners.id });
      if (!updated) fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '合作伙伴状态已更新，请刷新后重试');
    });
    return this.relationship(partner.id, session.customerUserId, session.organizationId);
  }

  async updateOwnProfile(session: AuthenticatedCustomer, eventId: number, input: UpdatePartnerProfile) {
    const assetIds = [input.avatarAssetId, ...input.gallery.map((item) => item.assetId)].filter(
      (value): value is string => Boolean(value),
    );
    if (assetIds.length) {
      const ownedAssets = await this.db()
        .select({ id: customerMediaAssets.id })
        .from(customerMediaAssets)
        .where(
          and(
            eq(customerMediaAssets.organizationId, session.organizationId),
            eq(customerMediaAssets.customerUserId, session.customerUserId),
            inArray(customerMediaAssets.id, assetIds),
            inArray(customerMediaAssets.kind, ['partner_avatar', 'partner_gallery']),
            inArray(customerMediaAssets.status, ['processing', 'ready']),
          ),
        );
      if (new Set(ownedAssets.map((asset) => asset.id)).size !== new Set(assetIds).size) {
        fail(API_ERROR_CODES.VALIDATION_ERROR, '图片不存在或无权使用', HttpStatus.BAD_REQUEST);
      }
    }
    return this.writeProfile(session, eventId, input.expectedVersion, (profile) => ({
      ...profile,
      displayName: input.displayName,
      company: input.company,
      title: input.title,
      industry: input.industry,
      businessIntro: input.businessIntro,
      businessUrl: input.businessUrl,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      wechatId: input.wechatId,
      avatarAssetId: input.avatarAssetId === undefined ? profile.avatarAssetId : input.avatarAssetId,
      gallery: input.gallery,
      actorType: 'customer' as const,
      actorId: session.customerUserId,
    }));
  }

  async updateOwnPrivacy(session: AuthenticatedCustomer, eventId: number, input: UpdatePartnerPrivacy) {
    return this.writeProfile(session, eventId, input.expectedVersion, (profile) => ({
      ...profile,
      publicStatus: input.publicStatus,
      visibleFields: input.visibleFields,
      posterFields: input.posterFields,
      searchIndexingEnabled: input.searchIndexingEnabled,
      actorType: 'customer' as const,
      actorId: session.customerUserId,
    }));
  }

  private async writeProfile(
    session: AuthenticatedCustomer,
    eventId: number,
    expectedPartnerVersion: number,
    mutate: (profile: ProfileRow) => Omit<ProfileRow, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const partner = await this.ownPartner(session, eventId);
    if (partner.version !== expectedPartnerVersion) {
      fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '合作伙伴资料已更新，请刷新后重试');
    }
    await this.db().transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(eventPartnerProfileVersions)
        .where(
          and(
            eq(eventPartnerProfileVersions.partnerId, partner.id),
            eq(eventPartnerProfileVersions.version, partner.profileVersion),
          ),
        )
        .limit(1);
      if (!profile) fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴资料不存在', HttpStatus.NOT_FOUND);
      const next = mutate(profile);
      await tx.insert(eventPartnerProfileVersions).values({
        ...next,
        partnerId: partner.id,
        organizationId: session.organizationId,
        eventId,
        version: partner.profileVersion + 1,
      });
      const [updated] = await tx
        .update(eventPartners)
        .set({
          profileVersion: partner.profileVersion + 1,
          version: sql`${eventPartners.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(eventPartners.id, partner.id), eq(eventPartners.version, expectedPartnerVersion)),
        )
        .returning({ id: eventPartners.id });
      if (!updated) fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '合作伙伴资料已更新，请刷新后重试');
    });
    return this.relationship(partner.id, session.customerUserId, session.organizationId);
  }

  async publicPartners(
    eventSlug: string,
    organizationSlug: string,
    limit: number,
    surface: 'directory' | 'homepage',
  ) {
    const [scope] = await this.db()
      .select({ id: events.id, slug: events.slug, organizationId: events.organizationId })
      .from(events)
      .innerJoin(organizations, eq(organizations.id, events.organizationId))
      .where(
        and(
          eq(events.slug, eventSlug),
          eq(organizations.slug, organizationSlug),
          inArray(events.status, [...PUBLIC_EVENT_STATUSES]),
        ),
      )
      .limit(1);
    if (!scope) fail(API_ERROR_CODES.NOT_FOUND, '大会不存在或尚未发布', HttpStatus.NOT_FOUND);
    const program = await this.activeProgram(scope.organizationId, scope.id);
    if (!program?.publicDirectoryEnabled) return { items: [], nextCursor: null };
    const rows = await this.db()
      .select({ partner: eventPartners, profile: eventPartnerProfileVersions })
      .from(eventPartners)
      .innerJoin(
        eventPartnerProfileVersions,
        and(
          eq(eventPartnerProfileVersions.partnerId, eventPartners.id),
          eq(eventPartnerProfileVersions.version, eventPartners.profileVersion),
        ),
      )
      .where(
        and(
          eq(eventPartners.organizationId, scope.organizationId),
          eq(eventPartners.eventId, scope.id),
          eq(eventPartners.qualificationStatus, 'active'),
          eq(eventPartnerProfileVersions.publicStatus, 'published'),
        ),
      )
      .orderBy(asc(eventPartners.sortOrder), asc(eventPartners.id))
      .limit(Math.min(limit, surface === 'homepage' ? program.homepageLimit : 100));
    return {
      items: rows.map((row) => publicSummary(row.profile, scope.slug, row.partner.publicSlug)),
      nextCursor: null,
    };
  }

  async publicPartner(eventSlug: string, publicSlug: string, organizationSlug: string) {
    const [row] = await this.db()
      .select({
        partner: eventPartners,
        profile: eventPartnerProfileVersions,
        event: events,
        organization: organizations,
      })
      .from(eventPartners)
      .innerJoin(events, eq(events.id, eventPartners.eventId))
      .innerJoin(organizations, eq(organizations.id, events.organizationId))
      .innerJoin(
        eventPartnerProfileVersions,
        and(
          eq(eventPartnerProfileVersions.partnerId, eventPartners.id),
          eq(eventPartnerProfileVersions.version, eventPartners.profileVersion),
        ),
      )
      .where(
        and(
          eq(events.slug, eventSlug),
          eq(organizations.slug, organizationSlug),
          inArray(events.status, [...PUBLIC_EVENT_STATUSES]),
          eq(eventPartners.publicSlug, publicSlug),
          eq(eventPartners.qualificationStatus, 'active'),
          eq(eventPartnerProfileVersions.publicStatus, 'published'),
        ),
      )
      .limit(1);
    if (!row) fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴不存在或尚未公开', HttpStatus.NOT_FOUND);
    const program = await this.activeProgram(row.partner.organizationId, row.partner.eventId);
    if (!program?.publicDirectoryEnabled) {
      fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴目录尚未开放', HttpStatus.NOT_FOUND);
    }
    const [link] = await this.db()
      .select()
      .from(partnerReferralLinks)
      .where(
        and(eq(partnerReferralLinks.partnerId, row.partner.id), eq(partnerReferralLinks.status, 'active')),
      )
      .limit(1);
    return {
      ...publicProfile(row.profile, row.event.slug, row.partner.publicSlug),
      referralPath: link ? `/r/${encodeURIComponent(link.code)}` : '',
      event: {
        id: row.event.id,
        slug: row.event.slug,
        name: row.event.name,
        startsAt: row.event.startsAt.toISOString(),
        endsAt: row.event.endsAt.toISOString(),
        city: row.event.city,
      },
    };
  }

  async publicPartnerMediaScope(
    eventSlug: string,
    publicSlug: string,
    organizationSlug: string,
    assetId?: string,
  ) {
    const [row] = await this.db()
      .select({ partner: eventPartners, profile: eventPartnerProfileVersions, organization: organizations })
      .from(eventPartners)
      .innerJoin(events, eq(events.id, eventPartners.eventId))
      .innerJoin(organizations, eq(organizations.id, events.organizationId))
      .innerJoin(
        eventPartnerProfileVersions,
        and(
          eq(eventPartnerProfileVersions.partnerId, eventPartners.id),
          eq(eventPartnerProfileVersions.version, eventPartners.profileVersion),
        ),
      )
      .where(
        and(
          eq(events.slug, eventSlug),
          eq(organizations.slug, organizationSlug),
          inArray(events.status, [...PUBLIC_EVENT_STATUSES]),
          eq(eventPartners.publicSlug, publicSlug),
          eq(eventPartners.qualificationStatus, 'active'),
          eq(eventPartnerProfileVersions.publicStatus, 'published'),
        ),
      )
      .limit(1);
    if (!row) fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴图片不存在', HttpStatus.NOT_FOUND);
    const program = await this.activeProgram(row.partner.organizationId, row.partner.eventId);
    if (!program?.publicDirectoryEnabled) {
      fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴图片不存在', HttpStatus.NOT_FOUND);
    }
    const requestedAssetId = assetId ?? row.profile.avatarAssetId;
    const avatarAllowed =
      row.profile.visibleFields.avatar && requestedAssetId === row.profile.avatarAssetId;
    const galleryAllowed =
      row.profile.visibleFields.gallery &&
      row.profile.gallery.some((item) => item.assetId === requestedAssetId);
    if (!requestedAssetId || (!avatarAllowed && !galleryAllowed)) {
      fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴图片不存在', HttpStatus.NOT_FOUND);
    }
    return {
      organizationId: row.partner.organizationId,
      customerUserId: row.partner.customerUserId,
      assetId: requestedAssetId,
    };
  }

  async resolveReferral(code: string, visitorFingerprint: string) {
    const [row] = await this.db()
      .select({ link: partnerReferralLinks, partner: eventPartners, event: events })
      .from(partnerReferralLinks)
      .innerJoin(eventPartners, eq(eventPartners.id, partnerReferralLinks.partnerId))
      .innerJoin(events, eq(events.id, partnerReferralLinks.eventId))
      .where(
        and(
          eq(partnerReferralLinks.code, code),
          eq(partnerReferralLinks.status, 'active'),
          eq(eventPartners.qualificationStatus, 'active'),
          eq(eventPartners.attributionEnabled, true),
        ),
      )
      .limit(1);
    if (!row || (row.link.expiresAt && row.link.expiresAt <= new Date())) {
      fail(API_ERROR_CODES.NOT_FOUND, '推广链接无效或已停止使用', HttpStatus.NOT_FOUND);
    }
    const program = await this.activeProgram(row.partner.organizationId, row.partner.eventId);
    if (!program) fail(API_ERROR_CODES.NOT_FOUND, '推广计划尚未启用', HttpStatus.NOT_FOUND);
    const expiresAt = new Date(Date.now() + program.attributionDays * 24 * 60 * 60 * 1000);
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const uniqueMarker = createHmac('sha256', referralSecret())
      .update(`${row.link.id}:${localDate}:${visitorFingerprint}`)
      .digest('hex');
    let uniqueVisit = 0;
    try {
      const stored = await this.redis
        .getClient()
        .set(`partner-referral-visit:${uniqueMarker}`, '1', 'EX', 3 * 24 * 60 * 60, 'NX');
      uniqueVisit = stored === 'OK' ? 1 : 0;
    } catch {
      // Local and recovery environments can run without Redis. The daily aggregate remains usable.
    }
    await this.db()
      .insert(partnerReferralVisitDays)
      .values({
        organizationId: row.partner.organizationId,
        eventId: row.partner.eventId,
        partnerId: row.partner.id,
        referralLinkId: row.link.id,
        localDate,
        visits: 1,
        uniqueVisits: uniqueVisit,
        timezoneSnapshot: 'Asia/Shanghai',
      })
      .onConflictDoUpdate({
        target: [partnerReferralVisitDays.referralLinkId, partnerReferralVisitDays.localDate],
        set: {
          visits: sql`${partnerReferralVisitDays.visits} + 1`,
          uniqueVisits: sql`${partnerReferralVisitDays.uniqueVisits} + ${uniqueVisit}`,
          updatedAt: new Date(),
        },
      });
    return {
      destinationPath: row.link.destinationPath || publicEventScopedPath('/register', row.event.slug),
      maxAge: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      cookie: signPartnerReferralContext({
        referralLinkId: row.link.id,
        partnerId: row.partner.id,
        organizationId: row.partner.organizationId,
        eventId: row.partner.eventId,
        expiresAt: expiresAt.toISOString(),
      }),
    };
  }

  async commissionList(session: AuthenticatedCustomer, eventId: number) {
    const partner = await this.ownPartner(session, eventId);
    const items = await this.db()
      .select()
      .from(partnerCommissions)
      .where(eq(partnerCommissions.partnerId, partner.id))
      .orderBy(desc(partnerCommissions.createdAt))
      .limit(100);
    return { items };
  }

  async payoutList(session: AuthenticatedCustomer, eventId: number) {
    const partner = await this.ownPartner(session, eventId);
    const [requests, recipients, documents] = await Promise.all([
      this.db()
        .select()
        .from(partnerPayoutRequests)
        .where(eq(partnerPayoutRequests.partnerId, partner.id))
        .orderBy(desc(partnerPayoutRequests.createdAt))
        .limit(100),
      this.db()
        .select({
          id: partnerPayoutRecipients.id,
          type: partnerPayoutRecipients.type,
          channel: partnerPayoutRecipients.channel,
          status: partnerPayoutRecipients.status,
          verifiedAt: partnerPayoutRecipients.verifiedAt,
          version: partnerPayoutRecipients.version,
        })
        .from(partnerPayoutRecipients)
        .where(eq(partnerPayoutRecipients.partnerId, partner.id))
        .orderBy(desc(partnerPayoutRecipients.createdAt)),
      this.db()
        .select({
          id: partnerPayoutDocuments.id,
          payoutRequestId: partnerPayoutDocuments.payoutRequestId,
          kind: partnerPayoutDocuments.kind,
          mediaType: partnerPayoutDocuments.mediaType,
          size: partnerPayoutDocuments.size,
          createdAt: partnerPayoutDocuments.createdAt,
        })
        .from(partnerPayoutDocuments)
        .where(
          and(
            eq(partnerPayoutDocuments.partnerId, partner.id),
            eq(partnerPayoutDocuments.status, 'active'),
          ),
        )
        .orderBy(desc(partnerPayoutDocuments.createdAt)),
    ]);
    return { requests, recipients, documents };
  }

  async createPayoutDocumentAccessToken(
    session: AuthenticatedCustomer,
    eventId: number,
    documentId: string,
  ) {
    const partner = await this.ownPartner(session, eventId);
    const [document] = await this.db()
      .select({ id: partnerPayoutDocuments.id })
      .from(partnerPayoutDocuments)
      .where(
        and(
          eq(partnerPayoutDocuments.id, documentId),
          eq(partnerPayoutDocuments.organizationId, session.organizationId),
          eq(partnerPayoutDocuments.eventId, eventId),
          eq(partnerPayoutDocuments.partnerId, partner.id),
          eq(partnerPayoutDocuments.status, 'active'),
        ),
      )
      .limit(1);
    if (!document) fail(API_ERROR_CODES.NOT_FOUND, '结算文件不存在', HttpStatus.NOT_FOUND);
    const token = randomBytes(32).toString('base64url');
    const payload: PayoutDocumentDownloadToken = {
      organizationId: session.organizationId,
      customerUserId: session.customerUserId,
      partnerId: partner.id,
      documentId,
    };
    try {
      await this.redis.getClient().setex(
        `tokems:partner-payout-document:${token}`,
        600,
        JSON.stringify(payload),
      );
    } catch {
      fail(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '结算文件授权服务暂时不可用',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return {
      downloadPath: `/api/v1/partner-payout-documents/${documentId}/download?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }

  async downloadPayoutDocument(documentId: string, token: string) {
    const payload = await (async () => {
      try {
        const raw = await this.redis
          .getClient()
          .getdel(`tokems:partner-payout-document:${token}`);
        return raw ? (JSON.parse(raw) as PayoutDocumentDownloadToken) : null;
      } catch {
        return null;
      }
    })();
    if (!payload || payload.documentId !== documentId) {
      fail(API_ERROR_CODES.UNAUTHORIZED, '结算文件访问授权无效或已过期', HttpStatus.UNAUTHORIZED);
    }
    const [document] = await this.db()
      .select()
      .from(partnerPayoutDocuments)
      .where(
        and(
          eq(partnerPayoutDocuments.id, documentId),
          eq(partnerPayoutDocuments.organizationId, payload.organizationId),
          eq(partnerPayoutDocuments.partnerId, payload.partnerId),
          eq(partnerPayoutDocuments.status, 'active'),
        ),
      )
      .limit(1);
    if (!document) fail(API_ERROR_CODES.NOT_FOUND, '结算文件不存在', HttpStatus.NOT_FOUND);
    const downloadUrl = payoutObjectStorageUrl(
      document.storageKey,
      'GET',
      undefined,
      process.env.S3_ENDPOINT,
    );
    if (!downloadUrl) {
      fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '对象存储尚未配置', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) fail(API_ERROR_CODES.NOT_FOUND, '结算文件不存在', HttpStatus.NOT_FOUND);
    const body = await readUploadWithinLimit(response, document.size);
    if (
      createHash('sha256').update(body).digest('hex') !== document.contentDigest ||
      !matchesDeclaredMediaType(body, document.mediaType)
    ) {
      fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '结算文件完整性校验失败');
    }
    await this.db().insert(auditLogs).values({
      organizationId: document.organizationId,
      eventId: document.eventId,
      actorId: payload.customerUserId,
      actorType: 'customer',
      action: 'partner.payout_document.accessed',
      resourceType: 'partner_payout_document',
      resourceId: document.id,
      before: {},
      after: { kind: document.kind, contentDigest: document.contentDigest },
      traceId: randomUUID(),
    });
    return { body, mediaType: document.mediaType, kind: document.kind };
  }

  async bindRecipient(
    session: AuthenticatedCustomer,
    eventId: number,
    input: {
      type: 'individual' | 'organization';
      channel: 'manual_bank' | 'wechat_transfer';
      displayName: string;
      accountReference: string;
      idempotencyKey: string;
    },
  ) {
    const partner = await this.ownPartner(session, eventId);
    if (input.channel === 'wechat_transfer') {
      fail(
        API_ERROR_CODES.VALIDATION_ERROR,
        '微信收款人请通过微信身份授权完成绑定',
        HttpStatus.BAD_REQUEST,
      );
    }
    const secret = payoutDataSecret();
    const fingerprint = createHmac('sha256', secret)
      .update(`${session.organizationId}:${input.channel}:${input.accountReference}`)
      .digest('hex');
    return this.db().transaction(async (tx) => {
      const [unsettled] = await tx
        .select({ id: partnerPayoutRequests.id })
        .from(partnerPayoutRequests)
        .where(
          and(
            eq(partnerPayoutRequests.partnerId, partner.id),
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
      if (unsettled) {
        fail(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '当前仍有未结清提现，请完成后再更换收款人',
        );
      }
      const [fingerprintOwner] = await tx
        .select({
          id: partnerPayoutRecipients.id,
          partnerId: partnerPayoutRecipients.partnerId,
          status: partnerPayoutRecipients.status,
          channel: partnerPayoutRecipients.channel,
          version: partnerPayoutRecipients.version,
        })
        .from(partnerPayoutRecipients)
        .where(
          and(
            eq(partnerPayoutRecipients.organizationId, session.organizationId),
            eq(partnerPayoutRecipients.accountFingerprint, fingerprint),
            inArray(partnerPayoutRecipients.status, ['pending', 'verified']),
          ),
        )
        .limit(1);
      if (fingerprintOwner?.partnerId === partner.id) return fingerprintOwner;
      if (fingerprintOwner) {
        fail(
          API_ERROR_CODES.INVALID_STATE_TRANSITION,
          '该收款账户已绑定其他合作伙伴，请联系大会财务核验',
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
            eq(partnerPayoutRecipients.partnerId, partner.id),
            eq(partnerPayoutRecipients.channel, input.channel),
            inArray(partnerPayoutRecipients.status, ['pending', 'verified']),
          ),
        );
      const [recipient] = await tx
        .insert(partnerPayoutRecipients)
        .values({
          organizationId: session.organizationId,
          partnerId: partner.id,
          customerUserId: session.customerUserId,
          type: input.type,
          channel: input.channel,
          displayNameCiphertext: sealSecret(input.displayName, secret),
          accountReferenceCiphertext: sealSecret(input.accountReference, secret),
          accountFingerprint: fingerprint,
          appId: null,
          openIdCiphertext: null,
        })
        .returning({
          id: partnerPayoutRecipients.id,
          status: partnerPayoutRecipients.status,
          channel: partnerPayoutRecipients.channel,
          version: partnerPayoutRecipients.version,
        });
      await tx.insert(auditLogs).values({
        organizationId: session.organizationId,
        eventId,
        actorId: session.customerUserId,
        actorType: 'customer',
        action: 'partner.payout_recipient.bound',
        resourceType: 'partner_payout_recipient',
        resourceId: recipient!.id,
        before: {},
        after: {
          type: input.type,
          channel: input.channel,
          fingerprint,
          idempotencyKeyHash: createHash('sha256').update(input.idempotencyKey).digest('hex'),
        },
        traceId: randomUUID(),
      });
      return recipient!;
    });
  }

  async createPayout(
    session: AuthenticatedCustomer,
    eventId: number,
    input: { amount: number; recipientId: string; idempotencyKey: string },
  ) {
    const partner = await this.ownPartner(session, eventId);
    if (partner.settlementHold) fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '当前收益处于结算暂停状态');
    const program = await this.activeProgram(session.organizationId, eventId);
    if (!program || input.amount < program.minimumPayoutAmount) {
      fail(
        API_ERROR_CODES.VALIDATION_ERROR,
        `税前可提现金额需满 ¥${((program?.minimumPayoutAmount ?? 1000) / 100).toFixed(2)}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`partner-payout-gate:${session.organizationId}:${eventId}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(partnerPayoutRequests)
        .where(
          and(
            eq(partnerPayoutRequests.partnerId, partner.id),
            eq(partnerPayoutRequests.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return existing;
      const [unresolvedReconciliation] = await tx
        .select({ id: partnerReconciliationRuns.id })
        .from(partnerReconciliationRuns)
        .where(unresolvedPayoutReconciliation(session.organizationId, eventId))
        .limit(1);
      if (unresolvedReconciliation) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '当前大会存在未关闭的出款对账差异，请联系财务处理');
      }
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`partner-balance:${partner.id}`}, 0))`,
      );
      const [recipient] = await tx
        .select()
        .from(partnerPayoutRecipients)
        .where(
          and(
            eq(partnerPayoutRecipients.id, input.recipientId),
            eq(partnerPayoutRecipients.partnerId, partner.id),
            eq(partnerPayoutRecipients.status, 'verified'),
          ),
        )
        .limit(1);
      if (!recipient) fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '请选择已完成验证的收款人');
      const balanceRows = await tx
        .select({ bucket: partnerLedgerEntries.balanceBucket, value: sum(partnerLedgerEntries.amount) })
        .from(partnerLedgerEntries)
        .where(
          and(
            eq(partnerLedgerEntries.partnerId, partner.id),
            inArray(partnerLedgerEntries.balanceBucket, ['available', 'recovery_due']),
          ),
        )
        .groupBy(partnerLedgerEntries.balanceBucket);
      const balances = Object.fromEntries(
        balanceRows.map((row) => [row.bucket, Number(row.value ?? 0)]),
      );
      if ((balances.recovery_due ?? 0) > 0) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '存在待追偿金额，请联系大会财务核对后再提现');
      }
      if ((balances.available ?? 0) < input.amount) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '可提现余额不足');
      }
      const [request] = await tx
        .insert(partnerPayoutRequests)
        .values({
          organizationId: session.organizationId,
          eventId,
          partnerId: partner.id,
          recipientId: recipient.id,
          idempotencyKey: input.idempotencyKey,
          status: 'submitted',
          grossAmount: input.amount,
          taxAmount: 0,
          netAmount: input.amount,
          settlementSnapshot: {
            programVersionId: program.id,
            minimumPayoutAmount: program.minimumPayoutAmount,
            requestedAt: new Date().toISOString(),
          },
          recipientVersion: recipient.version,
        })
        .returning();
      await tx.insert(partnerLedgerEntries).values([
        {
          organizationId: session.organizationId,
          eventId,
          partnerId: partner.id,
          payoutRequestId: request!.id,
          entryType: 'payout_reservation',
          balanceBucket: 'available',
          amount: -input.amount,
          businessKey: `payout:${request!.id}:available-reserve`,
          reason: '用户提交提现申请',
          actorType: 'customer',
          actorId: session.customerUserId,
        },
        {
          organizationId: session.organizationId,
          eventId,
          partnerId: partner.id,
          payoutRequestId: request!.id,
          entryType: 'payout_reservation',
          balanceBucket: 'reserved',
          amount: input.amount,
          businessKey: `payout:${request!.id}:reserved`,
          reason: '提现申请占用余额',
          actorType: 'customer',
          actorId: session.customerUserId,
        },
      ]);
      return request!;
    });
  }

  async confirmPayoutSettlement(
    session: AuthenticatedCustomer,
    eventId: number,
    requestId: string,
    expectedVersion: number,
  ) {
    const partner = await this.ownPartner(session, eventId);
    const [updated] = await this.db()
      .update(partnerPayoutRequests)
      .set({
        status: 'approved',
        userConfirmedAt: new Date(),
        version: sql`${partnerPayoutRequests.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(partnerPayoutRequests.id, requestId),
          eq(partnerPayoutRequests.organizationId, session.organizationId),
          eq(partnerPayoutRequests.eventId, eventId),
          eq(partnerPayoutRequests.partnerId, partner.id),
          eq(partnerPayoutRequests.status, 'under_review'),
          eq(partnerPayoutRequests.version, expectedVersion),
          isNull(partnerPayoutRequests.userConfirmedAt),
        ),
      )
      .returning();
    if (!updated) {
      fail(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '提现结算金额已更新，请刷新后确认',
        HttpStatus.CONFLICT,
      );
    }
    await this.db().insert(auditLogs).values({
      organizationId: session.organizationId,
      eventId,
      actorId: session.customerUserId,
      actorType: 'customer',
      action: 'partner.payout.settlement_confirmed',
      resourceType: 'partner_payout_request',
      resourceId: updated.id,
      before: { status: 'under_review' },
      after: {
        status: 'approved',
        grossAmount: updated.grossAmount,
        taxAmount: updated.taxAmount,
        netAmount: updated.netAmount,
      },
      traceId: randomUUID(),
    });
    return updated;
  }

  async createInquiry(
    session: AuthenticatedCustomer,
    eventId: number,
    input: {
      type: 'missing_order' | 'amount_dispute';
      orderReference: string;
      purchasedAt?: string | undefined;
      description: string;
      evidenceAssetIds: string[];
    },
  ) {
    const partner = await this.ownPartner(session, eventId);
    const [inquiry] = await this.db()
      .insert(partnerCommissionInquiries)
      .values({
        organizationId: session.organizationId,
        eventId,
        partnerId: partner.id,
        customerUserId: session.customerUserId,
        type: input.type,
        orderReference: input.orderReference,
        purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
        description: input.description,
        evidenceAssetIds: input.evidenceAssetIds,
      })
      .returning();
    return inquiry!;
  }

  async resolveInquiry(
    organizationId: string,
    eventId: number,
    inquiryId: string,
    actorId: string,
    input: {
      expectedVersion: number;
      decision: 'explained' | 'rejected' | 'credit_adjustment' | 'debit_adjustment';
      reason: string;
      adjustmentAmount?: number | undefined;
    },
  ) {
    return this.db().transaction(async (tx) => {
      const [inquiry] = await tx
        .select()
        .from(partnerCommissionInquiries)
        .where(
          and(
            eq(partnerCommissionInquiries.id, inquiryId),
            eq(partnerCommissionInquiries.organizationId, organizationId),
            eq(partnerCommissionInquiries.eventId, eventId),
          ),
        )
        .for('update')
        .limit(1);
      if (!inquiry) fail(API_ERROR_CODES.NOT_FOUND, '佣金申诉不存在', HttpStatus.NOT_FOUND);
      if (inquiry.version !== input.expectedVersion || !['open', 'under_review'].includes(inquiry.status)) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '佣金申诉状态已更新，请刷新后重试');
      }
      const adjusts = input.decision === 'credit_adjustment' || input.decision === 'debit_adjustment';
      const absoluteAmount = Math.abs(input.adjustmentAmount ?? 0);
      if (adjusts && absoluteAmount <= 0) {
        fail(API_ERROR_CODES.VALIDATION_ERROR, '调整决定需要填写调整金额', HttpStatus.BAD_REQUEST);
      }
      const signedAmount = input.decision === 'debit_adjustment' ? -absoluteAmount : absoluteAmount;
      const requiresSecondReview = adjusts && absoluteAmount >= 100_000;
      if (requiresSecondReview && !inquiry.adjustmentProposedBy) {
        const [proposed] = await tx
          .update(partnerCommissionInquiries)
          .set({
            status: 'under_review',
            decision: input.decision,
            decisionReason: input.reason,
            adjustmentAmount: signedAmount,
            adjustmentProposedBy: actorId,
            adjustmentProposedAt: new Date(),
            version: inquiry.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(partnerCommissionInquiries.id, inquiry.id))
          .returning();
        await tx.insert(auditLogs).values({
          organizationId,
          eventId,
          actorId,
          actorType: 'staff',
          action: 'partner.commission_adjustment.proposed',
          resourceType: 'partner_commission_inquiry',
          resourceId: inquiry.id,
          before: { status: inquiry.status, version: inquiry.version },
          after: {
            status: 'under_review',
            decision: input.decision,
            adjustmentAmount: signedAmount,
            version: proposed!.version,
          },
          traceId: randomUUID(),
        });
        return { ...proposed!, secondReviewRequired: true };
      }
      if (
        requiresSecondReview &&
        (inquiry.adjustmentProposedBy === actorId ||
          inquiry.decision !== input.decision ||
          inquiry.adjustmentAmount !== signedAmount)
      ) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '大额调整需要另一位管理员按原金额复核');
      }
      let adjustmentLedgerEntryId: string | null = null;
      if (adjusts) {
        const [available] = await tx
          .select({ value: sum(partnerLedgerEntries.amount) })
          .from(partnerLedgerEntries)
          .where(
            and(
              eq(partnerLedgerEntries.partnerId, inquiry.partnerId),
              eq(partnerLedgerEntries.balanceBucket, 'available'),
            ),
          );
        const availableAmount = Math.max(0, Number(available?.value ?? 0));
        if (signedAmount >= 0 || availableAmount >= absoluteAmount) {
          const [entry] = await tx
            .insert(partnerLedgerEntries)
            .values({
              organizationId,
              eventId,
              partnerId: inquiry.partnerId,
              entryType: 'manual_adjustment',
              balanceBucket: 'available',
              amount: signedAmount,
              businessKey: `inquiry:${inquiry.id}:adjustment`,
              reason: input.reason,
              evidence: { inquiryId: inquiry.id, decision: input.decision },
              actorType: 'staff',
              actorId,
            })
            .onConflictDoNothing()
            .returning({ id: partnerLedgerEntries.id });
          adjustmentLedgerEntryId = entry?.id ?? null;
        } else {
          const rows = await tx
            .insert(partnerLedgerEntries)
            .values([
              ...(availableAmount
                ? [{
                    organizationId,
                    eventId,
                    partnerId: inquiry.partnerId,
                    entryType: 'manual_adjustment' as const,
                    balanceBucket: 'available' as const,
                    amount: -availableAmount,
                    businessKey: `inquiry:${inquiry.id}:adjustment:available`,
                    reason: input.reason,
                    evidence: { inquiryId: inquiry.id, decision: input.decision },
                    actorType: 'staff',
                    actorId,
                  }]
                : []),
              {
                organizationId,
                eventId,
                partnerId: inquiry.partnerId,
                entryType: 'manual_adjustment' as const,
                balanceBucket: 'recovery_due' as const,
                amount: absoluteAmount - availableAmount,
                businessKey: `inquiry:${inquiry.id}:adjustment:recovery`,
                reason: input.reason,
                evidence: { inquiryId: inquiry.id, decision: input.decision },
                actorType: 'staff',
                actorId,
              },
            ])
            .onConflictDoNothing()
            .returning({ id: partnerLedgerEntries.id });
          adjustmentLedgerEntryId = rows.at(-1)?.id ?? null;
        }
      }
      const status = input.decision === 'rejected' ? 'rejected' : 'resolved';
      const [resolved] = await tx
        .update(partnerCommissionInquiries)
        .set({
          status,
          decision: input.decision,
          decisionReason: input.reason,
          adjustmentAmount: adjusts ? signedAmount : null,
          adjustmentLedgerEntryId,
          resolvedBy: actorId,
          resolvedAt: new Date(),
          version: inquiry.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(partnerCommissionInquiries.id, inquiry.id))
        .returning();
      await tx.insert(auditLogs).values({
        organizationId,
        eventId,
        actorId,
        actorType: 'staff',
        action: adjusts ? 'partner.commission_adjustment.approved' : 'partner.inquiry.resolved',
        resourceType: 'partner_commission_inquiry',
        resourceId: inquiry.id,
        before: { status: inquiry.status, version: inquiry.version },
        after: {
          status,
          decision: input.decision,
          adjustmentAmount: adjusts ? signedAmount : null,
          adjustmentLedgerEntryId,
          version: resolved!.version,
        },
        traceId: randomUUID(),
      });
      return { ...resolved!, secondReviewRequired: false };
    });
  }

  async createCommissionAdjustment(
    organizationId: string,
    eventId: number,
    actorId: string,
    input: {
      partnerId: string;
      inquiryId?: string | undefined;
      expectedVersion: number;
      amount: number;
      reason: string;
    },
  ) {
    let inquiryId = input.inquiryId;
    let expectedVersion = input.expectedVersion;
    if (inquiryId) {
      const [inquiry] = await this.db()
        .select({ id: partnerCommissionInquiries.id, partnerId: partnerCommissionInquiries.partnerId })
        .from(partnerCommissionInquiries)
        .where(
          and(
            eq(partnerCommissionInquiries.id, inquiryId),
            eq(partnerCommissionInquiries.organizationId, organizationId),
            eq(partnerCommissionInquiries.eventId, eventId),
            eq(partnerCommissionInquiries.partnerId, input.partnerId),
          ),
        )
        .limit(1);
      if (!inquiry) fail(API_ERROR_CODES.NOT_FOUND, '待复核佣金调整不存在', HttpStatus.NOT_FOUND);
    } else {
      const [partner] = await this.db()
        .select({ id: eventPartners.id, customerUserId: eventPartners.customerUserId })
        .from(eventPartners)
        .where(
          and(
            eq(eventPartners.id, input.partnerId),
            eq(eventPartners.organizationId, organizationId),
            eq(eventPartners.eventId, eventId),
          ),
        )
        .limit(1);
      if (!partner) fail(API_ERROR_CODES.NOT_FOUND, '合作伙伴不存在', HttpStatus.NOT_FOUND);
      const [created] = await this.db()
        .insert(partnerCommissionInquiries)
        .values({
          organizationId,
          eventId,
          partnerId: partner.id,
          customerUserId: partner.customerUserId,
          type: 'amount_dispute',
          orderReference: `ADMIN-${randomUUID().slice(0, 13).toUpperCase()}`,
          description: `后台佣金调整：${input.reason}`,
          evidenceAssetIds: [],
        })
        .returning({ id: partnerCommissionInquiries.id, version: partnerCommissionInquiries.version });
      inquiryId = created!.id;
      expectedVersion = created!.version;
    }
    return this.resolveInquiry(organizationId, eventId, inquiryId, actorId, {
      expectedVersion,
      decision: input.amount > 0 ? 'credit_adjustment' : 'debit_adjustment',
      reason: input.reason,
      adjustmentAmount: Math.abs(input.amount),
    });
  }

  async adminOverview(organizationId: string, eventId: number) {
    await this.eventForOrganization(organizationId, eventId);
    const [partnerCounts, commissionTotals, payoutTotals] = await Promise.all([
      this.db()
        .select({ status: eventPartners.qualificationStatus, value: count(eventPartners.id) })
        .from(eventPartners)
        .where(
          and(eq(eventPartners.organizationId, organizationId), eq(eventPartners.eventId, eventId)),
        )
        .groupBy(eventPartners.qualificationStatus),
      this.db()
        .select({ status: partnerCommissions.status, value: sum(partnerCommissions.commissionAmount) })
        .from(partnerCommissions)
        .where(
          and(eq(partnerCommissions.organizationId, organizationId), eq(partnerCommissions.eventId, eventId)),
        )
        .groupBy(partnerCommissions.status),
      this.db()
        .select({ status: partnerPayoutRequests.status, value: sum(partnerPayoutRequests.grossAmount) })
        .from(partnerPayoutRequests)
        .where(
          and(eq(partnerPayoutRequests.organizationId, organizationId), eq(partnerPayoutRequests.eventId, eventId)),
        )
        .groupBy(partnerPayoutRequests.status),
    ]);
    return {
      program: serializeProgram(await this.activeProgram(organizationId, eventId)),
      partnerCounts: Object.fromEntries(partnerCounts.map((item) => [item.status, item.value])),
      commissionTotals: Object.fromEntries(
        commissionTotals.map((item) => [item.status, Number(item.value ?? 0)]),
      ),
      payoutTotals: Object.fromEntries(payoutTotals.map((item) => [item.status, Number(item.value ?? 0)])),
    };
  }

  async adminPartners(organizationId: string, eventId: number) {
    const rows = await this.db()
      .select({ id: eventPartners.id, customerUserId: eventPartners.customerUserId })
      .from(eventPartners)
      .where(
        and(eq(eventPartners.organizationId, organizationId), eq(eventPartners.eventId, eventId)),
      )
      .orderBy(asc(eventPartners.sortOrder), desc(eventPartners.createdAt));
    return {
      items: await Promise.all(
        rows.map((row) => this.relationship(row.id, row.customerUserId, organizationId)),
      ),
    };
  }

  async adminPrograms(organizationId: string, eventId: number) {
    await this.eventForOrganization(organizationId, eventId);
    const rows = await this.db()
      .select()
      .from(eventPartnerProgramVersions)
      .where(
        and(
          eq(eventPartnerProgramVersions.organizationId, organizationId),
          eq(eventPartnerProgramVersions.eventId, eventId),
        ),
      )
      .orderBy(desc(eventPartnerProgramVersions.version))
      .limit(100);
    return { items: rows.map(serializeProgram) };
  }

  async adminCommissions(organizationId: string, eventId: number) {
    return {
      items: await this.db()
        .select()
        .from(partnerCommissions)
        .where(
          and(eq(partnerCommissions.organizationId, organizationId), eq(partnerCommissions.eventId, eventId)),
        )
        .orderBy(desc(partnerCommissions.createdAt))
        .limit(200),
    };
  }

  async adminInquiries(organizationId: string, eventId: number) {
    await this.eventForOrganization(organizationId, eventId);
    return {
      items: await this.db()
        .select()
        .from(partnerCommissionInquiries)
        .where(
          and(
            eq(partnerCommissionInquiries.organizationId, organizationId),
            eq(partnerCommissionInquiries.eventId, eventId),
          ),
        )
        .orderBy(desc(partnerCommissionInquiries.createdAt))
        .limit(200),
    };
  }

  async adminPayouts(organizationId: string, eventId: number) {
    return {
      requests: await this.db()
        .select()
        .from(partnerPayoutRequests)
        .where(
          and(eq(partnerPayoutRequests.organizationId, organizationId), eq(partnerPayoutRequests.eventId, eventId)),
        )
        .orderBy(desc(partnerPayoutRequests.createdAt))
        .limit(200),
      batches: await this.db()
        .select()
        .from(partnerPayoutBatches)
        .where(
          and(
            eq(partnerPayoutBatches.organizationId, organizationId),
            eq(partnerPayoutBatches.eventId, eventId),
          ),
        )
        .orderBy(desc(partnerPayoutBatches.createdAt))
        .limit(100),
      inquiries: await this.db()
        .select()
        .from(partnerCommissionInquiries)
        .where(
          and(
            eq(partnerCommissionInquiries.organizationId, organizationId),
            eq(partnerCommissionInquiries.eventId, eventId),
          ),
        )
        .orderBy(desc(partnerCommissionInquiries.createdAt))
        .limit(100),
      recipients: await this.db()
        .select({
          id: partnerPayoutRecipients.id,
          partnerId: partnerPayoutRecipients.partnerId,
          type: partnerPayoutRecipients.type,
          channel: partnerPayoutRecipients.channel,
          status: partnerPayoutRecipients.status,
          verifiedAt: partnerPayoutRecipients.verifiedAt,
          version: partnerPayoutRecipients.version,
          createdAt: partnerPayoutRecipients.createdAt,
        })
        .from(partnerPayoutRecipients)
        .innerJoin(eventPartners, eq(eventPartners.id, partnerPayoutRecipients.partnerId))
        .where(
          and(
            eq(partnerPayoutRecipients.organizationId, organizationId),
            eq(eventPartners.eventId, eventId),
          ),
        )
        .orderBy(desc(partnerPayoutRecipients.createdAt))
        .limit(200),
      documents: await this.db()
        .select({
          id: partnerPayoutDocuments.id,
          payoutRequestId: partnerPayoutDocuments.payoutRequestId,
          payoutExecutionId: partnerPayoutDocuments.payoutExecutionId,
          kind: partnerPayoutDocuments.kind,
          mediaType: partnerPayoutDocuments.mediaType,
          size: partnerPayoutDocuments.size,
          status: partnerPayoutDocuments.status,
          createdAt: partnerPayoutDocuments.createdAt,
        })
        .from(partnerPayoutDocuments)
        .where(
          and(
            eq(partnerPayoutDocuments.organizationId, organizationId),
            eq(partnerPayoutDocuments.eventId, eventId),
          ),
        )
        .orderBy(desc(partnerPayoutDocuments.createdAt))
        .limit(500),
      reconciliations: await this.db()
        .select()
        .from(partnerReconciliationRuns)
        .where(
          and(
            eq(partnerReconciliationRuns.organizationId, organizationId),
            eq(partnerReconciliationRuns.eventId, eventId),
          ),
        )
        .orderBy(desc(partnerReconciliationRuns.createdAt))
        .limit(100),
    };
  }

  async preparePayoutDocument(
    organizationId: string,
    eventId: number,
    actorId: string,
    input: {
      payoutRequestId: string;
      kind: PayoutDocumentUploadToken['kind'];
      fileName: string;
      mediaType: PayoutDocumentUploadToken['mediaType'];
      size: number;
      contentDigest: string;
    },
  ) {
    await this.eventForOrganization(organizationId, eventId);
    const [request] = await this.db()
      .select({ id: partnerPayoutRequests.id, partnerId: partnerPayoutRequests.partnerId })
      .from(partnerPayoutRequests)
      .where(
        and(
          eq(partnerPayoutRequests.id, input.payoutRequestId),
          eq(partnerPayoutRequests.organizationId, organizationId),
          eq(partnerPayoutRequests.eventId, eventId),
        ),
      )
      .limit(1);
    if (!request) fail(API_ERROR_CODES.NOT_FOUND, '提现申请不存在', HttpStatus.NOT_FOUND);
    const objectId = randomUUID();
    const storageKey = `partner-payouts/${organizationId}/${eventId}/${request.id}/${objectId}/original`;
    const uploadUrl = payoutObjectStorageUrl(
      storageKey,
      'PUT',
      input.mediaType,
      undefined,
      input.size,
    );
    if (!uploadUrl) {
      fail(
        API_ERROR_CODES.INVALID_STATE_TRANSITION,
        '对象存储尚未配置，暂时无法上传结算文件',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    return {
      uploadToken: signedPayoutDocumentToken({
        organizationId,
        eventId,
        payoutRequestId: request.id,
        partnerId: request.partnerId,
        kind: input.kind,
        storageKey,
        mediaType: input.mediaType,
        size: input.size,
        contentDigest: input.contentDigest.toLowerCase(),
        actorId,
        expiresAt,
      }),
      uploadUrl,
      headers: {
        'Content-Type': input.mediaType,
        'Content-Length': String(input.size),
        'If-None-Match': '*',
      },
      expiresAt,
    };
  }

  async confirmPayoutDocument(
    organizationId: string,
    eventId: number,
    actorId: string,
    uploadToken: string,
  ) {
    const payload = readPayoutDocumentToken(uploadToken);
    if (
      !payload ||
      payload.organizationId !== organizationId ||
      payload.eventId !== eventId ||
      payload.actorId !== actorId
    ) {
      fail(API_ERROR_CODES.UNAUTHORIZED, '结算文件上传授权无效或已过期', HttpStatus.UNAUTHORIZED);
    }
    const internalUrl = payoutObjectStorageUrl(
      payload.storageKey,
      'GET',
      undefined,
      process.env.S3_ENDPOINT,
    );
    if (!internalUrl) {
      fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '对象存储尚未配置', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const response = await fetch(internalUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      fail(API_ERROR_CODES.VALIDATION_ERROR, '结算文件尚未上传成功', HttpStatus.BAD_REQUEST);
    }
    const file = await readUploadWithinLimit(response, payload.size);
    if (
      createHash('sha256').update(file).digest('hex') !== payload.contentDigest ||
      !matchesDeclaredMediaType(file, payload.mediaType)
    ) {
      fail(
        API_ERROR_CODES.VALIDATION_ERROR,
        '结算文件内容校验失败',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.db().transaction(async (tx) => {
      const [request] = await tx
        .select({ id: partnerPayoutRequests.id })
        .from(partnerPayoutRequests)
        .where(
          and(
            eq(partnerPayoutRequests.id, payload.payoutRequestId),
            eq(partnerPayoutRequests.organizationId, organizationId),
            eq(partnerPayoutRequests.eventId, eventId),
            eq(partnerPayoutRequests.partnerId, payload.partnerId),
          ),
        )
        .limit(1);
      if (!request) fail(API_ERROR_CODES.NOT_FOUND, '提现申请不存在', HttpStatus.NOT_FOUND);
      const [existing] = await tx
        .select()
        .from(partnerPayoutDocuments)
        .where(
          and(
            eq(partnerPayoutDocuments.organizationId, organizationId),
            eq(partnerPayoutDocuments.payoutRequestId, payload.payoutRequestId),
            eq(partnerPayoutDocuments.kind, payload.kind),
            eq(partnerPayoutDocuments.contentDigest, payload.contentDigest),
          ),
        )
        .limit(1);
      if (existing) return existing;
      const [document] = await tx
        .insert(partnerPayoutDocuments)
        .values({
          organizationId,
          eventId,
          partnerId: payload.partnerId,
          payoutRequestId: payload.payoutRequestId,
          kind: payload.kind,
          storageKey: payload.storageKey,
          mediaType: payload.mediaType,
          size: payload.size,
          contentDigest: payload.contentDigest,
          createdBy: actorId,
        })
        .returning();
      await tx.insert(auditLogs).values({
        organizationId,
        eventId,
        actorId,
        actorType: 'staff',
        action: 'partner.payout_document.created',
        resourceType: 'partner_payout_document',
        resourceId: document!.id,
        before: {},
        after: {
          payoutRequestId: payload.payoutRequestId,
          kind: payload.kind,
          size: payload.size,
          contentDigest: payload.contentDigest,
        },
        traceId: randomUUID(),
      });
      return document!;
    });
  }

  async createReconciliation(
    organizationId: string,
    eventId: number,
    actorId: string,
    input: {
      kind: 'payments' | 'refunds' | 'payouts';
      batchId: string | null;
      windowStart: string;
      windowEnd: string;
      checkedCount: number;
      differenceCount: number;
      differenceAmount: number;
      evidenceReference: string;
      evidenceDigest: string;
      note: string;
    },
  ) {
    await this.eventForOrganization(organizationId, eventId);
    if (input.batchId) {
      const [batch] = await this.db()
        .select({ id: partnerPayoutBatches.id })
        .from(partnerPayoutBatches)
        .where(
          and(
            eq(partnerPayoutBatches.id, input.batchId),
            eq(partnerPayoutBatches.organizationId, organizationId),
            eq(partnerPayoutBatches.eventId, eventId),
          ),
        )
        .limit(1);
      if (!batch) fail(API_ERROR_CODES.NOT_FOUND, '出款批次不存在', HttpStatus.NOT_FOUND);
    }
    return this.db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`partner-payout-gate:${organizationId}:${eventId}`}, 0))`,
      );
      const status = input.differenceCount === 0 ? 'matched' : 'difference';
      const [created] = await tx
        .insert(partnerReconciliationRuns)
        .values({
          organizationId,
          eventId,
          batchId: input.batchId,
          kind: input.kind,
          status,
          windowStart: new Date(input.windowStart),
          windowEnd: new Date(input.windowEnd),
          checkedCount: input.checkedCount,
          differenceCount: input.differenceCount,
          differenceAmount: input.differenceAmount,
          evidence: {
            source: input.kind === 'payouts' ? 'wechat-fund-bill' : 'manual-reconciliation',
            reference: input.evidenceReference,
            digest: input.evidenceDigest.toLowerCase(),
            ...(input.note ? { note: input.note } : {}),
          },
          startedBy: actorId,
        })
        .returning();
      await tx.insert(auditLogs).values({
        organizationId,
        eventId,
        actorId,
        actorType: 'staff',
        action: 'partner.reconciliation.imported',
        resourceType: 'partner_reconciliation_run',
        resourceId: created!.id,
        before: {},
        after: {
          kind: input.kind,
          status,
          batchId: input.batchId,
          checkedCount: input.checkedCount,
          differenceCount: input.differenceCount,
          differenceAmount: input.differenceAmount,
          evidenceDigest: input.evidenceDigest.toLowerCase(),
        },
        traceId: randomUUID(),
      });
      return created!;
    });
  }

  async resolveReconciliation(
    organizationId: string,
    eventId: number,
    reconciliationId: string,
    actorId: string,
    reason: string,
  ) {
    return this.db().transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(partnerReconciliationRuns)
        .where(
          and(
            eq(partnerReconciliationRuns.id, reconciliationId),
            eq(partnerReconciliationRuns.organizationId, organizationId),
            eq(partnerReconciliationRuns.eventId, eventId),
          ),
        )
        .for('update')
        .limit(1);
      if (!run) fail(API_ERROR_CODES.NOT_FOUND, '对账记录不存在', HttpStatus.NOT_FOUND);
      if (!['difference', 'failed'].includes(run.status)) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '当前对账记录无需人工销账');
      }
      const [updated] = await tx
        .update(partnerReconciliationRuns)
        .set({
          status: 'resolved',
          evidence: { ...run.evidence, resolutionReason: reason },
          resolvedBy: actorId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(partnerReconciliationRuns.id, run.id))
        .returning();
      await tx.insert(auditLogs).values({
        organizationId,
        eventId,
        actorId,
        actorType: 'staff',
        action: 'partner.reconciliation.resolved',
        resourceType: 'partner_reconciliation_run',
        resourceId: run.id,
        before: { status: run.status },
        after: { status: 'resolved', reason },
        traceId: randomUUID(),
      });
      return updated!;
    });
  }

  async exportPayouts(organizationId: string, eventId: number) {
    await this.eventForOrganization(organizationId, eventId);
    const rows = await this.db()
      .select({
        requestId: partnerPayoutRequests.id,
        partnerSlug: eventPartners.publicSlug,
        channel: partnerPayoutRecipients.channel,
        status: partnerPayoutRequests.status,
        grossAmount: partnerPayoutRequests.grossAmount,
        taxAmount: partnerPayoutRequests.taxAmount,
        netAmount: partnerPayoutRequests.netAmount,
        currency: partnerPayoutRequests.currency,
        reviewedAt: partnerPayoutRequests.reviewedAt,
        completedAt: partnerPayoutRequests.completedAt,
        createdAt: partnerPayoutRequests.createdAt,
      })
      .from(partnerPayoutRequests)
      .innerJoin(eventPartners, eq(eventPartners.id, partnerPayoutRequests.partnerId))
      .innerJoin(
        partnerPayoutRecipients,
        eq(partnerPayoutRecipients.id, partnerPayoutRequests.recipientId),
      )
      .where(
        and(
          eq(partnerPayoutRequests.organizationId, organizationId),
          eq(partnerPayoutRequests.eventId, eventId),
        ),
      )
      .orderBy(desc(partnerPayoutRequests.createdAt))
      .limit(5_000);
    return rows;
  }

  async verifyRecipient(organizationId: string, recipientId: string, actorId: string) {
    const [recipient] = await this.db()
      .update(partnerPayoutRecipients)
      .set({ status: 'verified', verifiedAt: new Date(), version: sql`${partnerPayoutRecipients.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(partnerPayoutRecipients.id, recipientId),
          eq(partnerPayoutRecipients.organizationId, organizationId),
        ),
      )
      .returning();
    if (!recipient) fail(API_ERROR_CODES.NOT_FOUND, '收款人不存在', HttpStatus.NOT_FOUND);
    await this.db().insert(auditLogs).values({
      organizationId,
      actorId,
      actorType: 'staff',
      action: 'partner.payout_recipient.verified',
      resourceType: 'partner_payout_recipient',
      resourceId: recipient.id,
      before: {},
      after: { status: 'verified' },
      traceId: randomUUID(),
    });
    return { id: recipient.id, status: recipient.status, version: recipient.version };
  }

  async reviewPayout(
    organizationId: string,
    eventId: number,
    requestId: string,
    actorId: string,
    input: {
      expectedVersion: number;
      decision: 'approve' | 'reject';
      reason: string;
      taxAmount?: number | undefined;
    },
  ) {
    return this.db().transaction(async (tx) => {
      if (input.decision === 'approve') {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`partner-payout-gate:${organizationId}:${eventId}`}, 0))`,
        );
        const [unresolvedReconciliation] = await tx
          .select({ id: partnerReconciliationRuns.id })
          .from(partnerReconciliationRuns)
          .where(unresolvedPayoutReconciliation(organizationId, eventId))
          .limit(1);
        if (unresolvedReconciliation) {
          fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '当前大会存在未关闭的出款对账差异，暂不能通过提现');
        }
      }
      const [request] = await tx
        .select()
        .from(partnerPayoutRequests)
        .where(
          and(
            eq(partnerPayoutRequests.id, requestId),
            eq(partnerPayoutRequests.organizationId, organizationId),
            eq(partnerPayoutRequests.eventId, eventId),
          ),
        )
        .for('update')
        .limit(1);
      if (!request) fail(API_ERROR_CODES.NOT_FOUND, '提现申请不存在', HttpStatus.NOT_FOUND);
      if (request.version !== input.expectedVersion || request.status !== 'submitted') {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '提现申请状态已更新，请刷新后重试');
      }
      if (input.decision === 'approve') {
        const [recovery] = await tx
          .select({ value: sum(partnerLedgerEntries.amount) })
          .from(partnerLedgerEntries)
          .where(
            and(
              eq(partnerLedgerEntries.partnerId, request.partnerId),
              eq(partnerLedgerEntries.balanceBucket, 'recovery_due'),
            ),
          );
        if (Number(recovery?.value ?? 0) > 0) {
          fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '该合作伙伴存在待追偿金额，请先完成财务核对');
        }
      }
      const taxAmount = input.decision === 'approve' ? (input.taxAmount ?? 0) : request.taxAmount;
      if (taxAmount > request.grossAmount) {
        fail(API_ERROR_CODES.VALIDATION_ERROR, '税额不能超过税前提现金额', HttpStatus.BAD_REQUEST);
      }
      const status = input.decision === 'approve' ? 'under_review' : 'rejected';
      const [updated] = await tx
        .update(partnerPayoutRequests)
        .set({
          status,
          taxAmount,
          netAmount: request.grossAmount - taxAmount,
          userConfirmedAt: null,
          settlementSnapshot: {
            ...request.settlementSnapshot,
            grossAmount: request.grossAmount,
            taxAmount,
            netAmount: request.grossAmount - taxAmount,
            recipientVersion: request.recipientVersion,
            finalizedAt: new Date().toISOString(),
          },
          reviewedBy: actorId,
          reviewedAt: new Date(),
          reviewReason: input.reason,
          version: request.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(partnerPayoutRequests.id, request.id))
        .returning();
      if (status === 'rejected') {
        await tx.insert(partnerLedgerEntries).values([
          {
            organizationId,
            eventId,
            partnerId: request.partnerId,
            payoutRequestId: request.id,
            entryType: 'payout_release',
            balanceBucket: 'reserved',
            amount: -request.grossAmount,
            businessKey: `payout:${request.id}:rejected:reserved`,
            reason: input.reason,
            actorType: 'staff',
            actorId,
          },
          {
            organizationId,
            eventId,
            partnerId: request.partnerId,
            payoutRequestId: request.id,
            entryType: 'payout_release',
            balanceBucket: 'available',
            amount: request.grossAmount,
            businessKey: `payout:${request.id}:rejected:available`,
            reason: input.reason,
            actorType: 'staff',
            actorId,
          },
        ]);
      }
      return updated!;
    });
  }

  async createPayoutBatch(
    organizationId: string,
    eventId: number,
    actorId: string,
    input: {
      requestIds: string[];
      channel: 'manual_bank' | 'wechat_transfer';
      cutoffAt: string;
      idempotencyKey: string;
    },
  ) {
    return this.db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`partner-payout-gate:${organizationId}:${eventId}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(partnerPayoutBatches)
        .where(
          and(
            eq(partnerPayoutBatches.organizationId, organizationId),
            eq(partnerPayoutBatches.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return existing;
      const [unresolvedReconciliation] = await tx
        .select({ id: partnerReconciliationRuns.id })
        .from(partnerReconciliationRuns)
        .where(unresolvedPayoutReconciliation(organizationId, eventId))
        .limit(1);
      if (unresolvedReconciliation) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '当前大会存在未关闭的出款对账差异，暂不能创建批次');
      }
      const requests = await tx
        .select({ request: partnerPayoutRequests, recipient: partnerPayoutRecipients })
        .from(partnerPayoutRequests)
        .innerJoin(partnerPayoutRecipients, eq(partnerPayoutRecipients.id, partnerPayoutRequests.recipientId))
        .where(
          and(
            eq(partnerPayoutRequests.organizationId, organizationId),
            eq(partnerPayoutRequests.eventId, eventId),
            inArray(partnerPayoutRequests.id, input.requestIds),
            eq(partnerPayoutRequests.status, 'approved'),
            eq(partnerPayoutRecipients.channel, input.channel),
            sql`not exists (
              select 1 from partner_ledger_entries recovery
              where recovery.partner_id = ${partnerPayoutRequests.partnerId}
                and recovery.balance_bucket = 'recovery_due'
              group by recovery.partner_id
              having sum(recovery.amount) > 0
            )`,
          ),
        );
      if (requests.length !== input.requestIds.length) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '部分提现申请不可组批或结算渠道不一致');
      }
      const totals = requests.reduce(
        (value, row) => ({
          gross: value.gross + row.request.grossAmount,
          tax: value.tax + row.request.taxAmount,
          net: value.net + row.request.netAmount,
        }),
        { gross: 0, tax: 0, net: 0 },
      );
      const [batch] = await tx
        .insert(partnerPayoutBatches)
        .values({
          organizationId,
          eventId,
          status: 'draft',
          channel: input.channel,
          cutoffAt: new Date(input.cutoffAt),
          requestCount: requests.length,
          grossAmount: totals.gross,
          taxAmount: totals.tax,
          netAmount: totals.net,
          budgetReservedAmount: totals.net,
          idempotencyKey: input.idempotencyKey,
          createdBy: actorId,
        })
        .returning();
      await tx
        .update(partnerPayoutRequests)
        .set({ batchId: batch!.id, status: 'batched', version: sql`${partnerPayoutRequests.version} + 1`, updatedAt: new Date() })
        .where(inArray(partnerPayoutRequests.id, input.requestIds));
      return batch!;
    });
  }

  async approvePayoutBatch(
    organizationId: string,
    batchId: string,
    actorId: string,
    input: { expectedVersion: number; decision: 'approve' | 'hold' | 'cancel'; reason: string },
  ) {
    return this.db().transaction(async (tx) => {
      const [batch] = await tx
        .select()
        .from(partnerPayoutBatches)
        .where(
          and(eq(partnerPayoutBatches.id, batchId), eq(partnerPayoutBatches.organizationId, organizationId)),
        )
        .for('update')
        .limit(1);
      if (!batch) fail(API_ERROR_CODES.NOT_FOUND, '出款批次不存在', HttpStatus.NOT_FOUND);
      if (!batch.eventId) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '组织级跨大会批次暂不支持自动复核');
      }
      if (batch.createdBy === actorId) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '出款批次需要另一位管理员复核');
      }
      if (batch.version !== input.expectedVersion || batch.status !== 'draft') {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '出款批次状态已更新，请刷新后重试');
      }
      if (input.decision === 'approve') {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`partner-payout-gate:${organizationId}:${batch.eventId}`}, 0))`,
        );
        const [unresolvedReconciliation] = await tx
          .select({ id: partnerReconciliationRuns.id })
          .from(partnerReconciliationRuns)
          .where(unresolvedPayoutReconciliation(organizationId, batch.eventId, batch.id))
          .limit(1);
        if (unresolvedReconciliation) {
          fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '当前批次存在未关闭的出款对账差异，暂不能复核通过');
        }
      }
      const status = input.decision === 'approve' ? 'approved' : input.decision === 'hold' ? 'held' : 'cancelled';
      const [updated] = await tx
        .update(partnerPayoutBatches)
        .set({
          status,
          approvedBy: actorId,
          approvedAt: new Date(),
          approvalReason: input.reason,
          version: batch.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(partnerPayoutBatches.id, batch.id), eq(partnerPayoutBatches.version, batch.version)),
        )
        .returning();
      if (status === 'cancelled') {
        await tx
          .update(partnerPayoutRequests)
          .set({
            batchId: null,
            status: 'approved',
            version: sql`${partnerPayoutRequests.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(partnerPayoutRequests.batchId, batch.id),
              eq(partnerPayoutRequests.status, 'batched'),
            ),
          );
      }
      return updated!;
    });
  }

  async completeManualPayout(
    organizationId: string,
    eventId: number,
    requestId: string,
    actorId: string,
    input: {
      expectedVersion: number;
      externalReference: string;
      paidAt: string;
      documentAssetId: string | null;
    },
  ) {
    return this.db().transaction(async (tx) => {
      const [request] = await tx
        .select({ request: partnerPayoutRequests, batch: partnerPayoutBatches })
        .from(partnerPayoutRequests)
        .innerJoin(partnerPayoutBatches, eq(partnerPayoutBatches.id, partnerPayoutRequests.batchId))
        .where(
          and(
            eq(partnerPayoutRequests.id, requestId),
            eq(partnerPayoutRequests.organizationId, organizationId),
            eq(partnerPayoutRequests.eventId, eventId),
          ),
        )
        .for('update')
        .limit(1);
      if (!request) fail(API_ERROR_CODES.NOT_FOUND, '提现申请不存在', HttpStatus.NOT_FOUND);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`partner-payout-gate:${organizationId}:${eventId}`}, 0))`,
      );
      const [unresolvedReconciliation] = await tx
        .select({ id: partnerReconciliationRuns.id })
        .from(partnerReconciliationRuns)
        .where(unresolvedPayoutReconciliation(organizationId, eventId, request.batch.id))
        .limit(1);
      if (unresolvedReconciliation) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '当前批次存在未关闭的出款对账差异，暂不能登记到账');
      }
      if (
        request.request.status !== 'batched' ||
        request.batch.channel !== 'manual_bank' ||
        request.batch.status !== 'approved'
      ) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '当前申请不能执行人工结算');
      }
      const [recovery] = await tx
        .select({ value: sum(partnerLedgerEntries.amount) })
        .from(partnerLedgerEntries)
        .where(
          and(
            eq(partnerLedgerEntries.partnerId, request.request.partnerId),
            eq(partnerLedgerEntries.balanceBucket, 'recovery_due'),
          ),
        );
      if (Number(recovery?.value ?? 0) > 0) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '该合作伙伴存在待追偿金额，当前申请暂停执行');
      }
      if (
        request.batch.approvedBy === actorId ||
        request.request.version !== input.expectedVersion
      ) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '人工结算需要复核管理员执行并使用最新版本');
      }
      if (input.documentAssetId) {
        const [document] = await tx
          .select({ id: partnerPayoutDocuments.id })
          .from(partnerPayoutDocuments)
          .where(
            and(
              eq(partnerPayoutDocuments.id, input.documentAssetId),
              eq(partnerPayoutDocuments.organizationId, organizationId),
              eq(partnerPayoutDocuments.eventId, eventId),
              eq(partnerPayoutDocuments.payoutRequestId, request.request.id),
              eq(partnerPayoutDocuments.kind, 'manual_receipt'),
              eq(partnerPayoutDocuments.status, 'active'),
            ),
          )
          .limit(1);
        if (!document) fail(API_ERROR_CODES.NOT_FOUND, '人工结算回单不存在', HttpStatus.NOT_FOUND);
      }
      const [execution] = await tx
        .insert(partnerPayoutExecutions)
        .values({
          organizationId,
          eventId,
          partnerId: request.request.partnerId,
          payoutRequestId: request.request.id,
          batchId: request.batch.id,
          channel: 'manual_bank',
          status: 'SUCCESS',
          sceneId: '1005',
          jobType: '推广合作伙伴',
          remunerationDescription: '大会推广佣金',
          amount: request.request.netAmount,
          recipientVersion: request.request.recipientVersion,
          merchantBillNo: `MANUAL${Date.now()}${randomBytes(4).toString('hex')}`,
          externalReference: input.externalReference,
          integrationRevision: 0,
          credentialVersion: 0,
          recipientSnapshot: { recipientVersion: request.request.recipientVersion },
          requestSnapshot: {
            amount: request.request.netAmount,
            externalReference: input.externalReference,
          },
          responseSnapshot: { status: 'SUCCESS' },
          submittedAt: new Date(input.paidAt),
          succeededAt: new Date(input.paidAt),
          lastQueriedAt: new Date(),
        })
        .returning();
      await tx
        .update(partnerPayoutRequests)
        .set({
          status: 'succeeded',
          completedAt: new Date(input.paidAt),
          version: request.request.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(partnerPayoutRequests.id, request.request.id));
      if (input.documentAssetId) {
        await tx
          .update(partnerPayoutDocuments)
          .set({ payoutExecutionId: execution!.id, updatedAt: new Date() })
          .where(eq(partnerPayoutDocuments.id, input.documentAssetId));
      }
      await tx.insert(partnerLedgerEntries).values([
        {
          organizationId,
          eventId,
          partnerId: request.request.partnerId,
          payoutRequestId: request.request.id,
          payoutExecutionId: execution!.id,
          entryType: 'payout',
          balanceBucket: 'reserved',
          amount: -request.request.grossAmount,
          businessKey: `payout:${request.request.id}:manual:reserved`,
          reason: '人工结算完成',
          actorType: 'staff',
          actorId,
        },
        {
          organizationId,
          eventId,
          partnerId: request.request.partnerId,
          payoutRequestId: request.request.id,
          payoutExecutionId: execution!.id,
          entryType: 'payout',
          balanceBucket: 'paid',
          amount: request.request.grossAmount,
          businessKey: `payout:${request.request.id}:manual:paid`,
          reason: '人工结算完成',
          actorType: 'staff',
          actorId,
        },
      ]);
      const [remaining] = await tx
        .select({ value: count(partnerPayoutRequests.id) })
        .from(partnerPayoutRequests)
        .where(
          and(
            eq(partnerPayoutRequests.batchId, request.batch.id),
            sql`${partnerPayoutRequests.status} <> 'succeeded'`,
          ),
        );
      if (Number(remaining?.value ?? 0) === 0) {
        await tx
          .update(partnerPayoutBatches)
          .set({ status: 'completed', completedAt: new Date(input.paidAt), updatedAt: new Date() })
          .where(eq(partnerPayoutBatches.id, request.batch.id));
      }
      return execution!;
    });
  }

  async getTransferConfiguration(organizationId: string) {
    const [integration] = await this.db()
      .select()
      .from(organizationIntegrations)
      .where(
        and(
          eq(organizationIntegrations.organizationId, organizationId),
          eq(organizationIntegrations.provider, 'wechatpay'),
        ),
      )
      .limit(1);
    const raw = integration?.config?.merchantTransfer;
    return {
      revision: integration?.revision ?? 0,
      configuration: PartnerTransferConfigurationSchema.parse(raw ?? {}),
      merchantConfigured: Boolean(integration?.encryptedCredentials),
      status: integration?.status ?? 'unconfigured',
      pending:
        integration?.config?.merchantTransferPending &&
        typeof integration.config.merchantTransferPending === 'object'
          ? integration.config.merchantTransferPending
          : null,
    };
  }

  async updateTransferConfiguration(
    organizationId: string,
    actorId: string,
    expectedRevision: number,
    configuration: PartnerTransferConfiguration,
  ) {
    return this.db().transaction(async (tx) => {
      const [integration] = await tx
        .select()
        .from(organizationIntegrations)
        .where(
          and(
            eq(organizationIntegrations.organizationId, organizationId),
            eq(organizationIntegrations.provider, 'wechatpay'),
          ),
        )
        .for('update')
        .limit(1);
      if (!integration) fail(API_ERROR_CODES.NOT_FOUND, '请先配置微信支付集成', HttpStatus.NOT_FOUND);
      if (integration.revision !== expectedRevision) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '微信支付配置已更新，请刷新后重试');
      }
      if (configuration.enabled && (!integration.encryptedCredentials || !configuration.verifiedAt)) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '请完成商户资质和商家转账配置验收后启用');
      }
      const pending =
        integration.config.merchantTransferPending &&
        typeof integration.config.merchantTransferPending === 'object'
          ? (integration.config.merchantTransferPending as Record<string, unknown>)
          : null;
      const matchesPending =
        pending && JSON.stringify(pending.configuration) === JSON.stringify(configuration);
      if (!matchesPending) {
        const [proposed] = await tx
          .update(organizationIntegrations)
          .set({
            config: {
              ...integration.config,
              merchantTransferPending: {
                configuration,
                proposedBy: actorId,
                proposedAt: new Date().toISOString(),
              },
            },
            revision: integration.revision + 1,
            updatedBy: actorId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(organizationIntegrations.id, integration.id),
              eq(organizationIntegrations.revision, integration.revision),
            ),
          )
          .returning();
        await tx.insert(auditLogs).values({
          organizationId,
          actorId,
          actorType: 'staff',
          action: 'partner.payout_configuration.proposed',
          resourceType: 'organization_integration',
          resourceId: integration.id,
          before: {
            revision: integration.revision,
            configuration: integration.config.merchantTransfer ?? null,
          },
          after: { revision: proposed!.revision, configuration },
          traceId: randomUUID(),
        });
        return {
          revision: proposed!.revision,
          configuration: PartnerTransferConfigurationSchema.parse(
            integration.config.merchantTransfer ?? {},
          ),
          pending: proposed!.config.merchantTransferPending,
          secondReviewRequired: true,
          merchantConfigured: Boolean(proposed!.encryptedCredentials),
          status: proposed!.status,
        };
      }
      if (pending.proposedBy === actorId) {
        fail(API_ERROR_CODES.INVALID_STATE_TRANSITION, '商家转账配置需要另一位管理员复核');
      }
      const [updated] = await tx
        .update(organizationIntegrations)
        .set({
          config: {
            ...integration.config,
            merchantTransfer: configuration,
            merchantTransferPending: null,
          },
          revision: integration.revision + 1,
          updatedBy: actorId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationIntegrations.id, integration.id),
            eq(organizationIntegrations.revision, integration.revision),
          ),
          )
          .returning();
      await tx.insert(auditLogs).values({
        organizationId,
        actorId,
        actorType: 'staff',
        action: 'partner.payout_configuration.approved',
        resourceType: 'organization_integration',
        resourceId: integration.id,
        before: {
          revision: integration.revision,
          configuration: integration.config.merchantTransfer ?? null,
          proposedBy: pending.proposedBy,
        },
        after: { revision: updated!.revision, configuration },
        traceId: randomUUID(),
      });
      return {
        revision: updated!.revision,
        configuration,
        pending: null,
        secondReviewRequired: false,
        merchantConfigured: Boolean(updated!.encryptedCredentials),
        status: updated!.status,
      };
    });
  }

  calculateAdjustment(amount: number, rateBps: number) {
    return calculateCommissionLine({ grossAmount: amount, rateBps, eligible: true });
  }
}
