import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PARTNER_POSTER_FIELDS,
  DEFAULT_PARTNER_VISIBLE_FIELDS,
} from '@conference/contracts';
import {
  createDatabase,
  customerUsers,
  eventPartnerProfileVersions,
  eventPartners,
  events,
  organizations,
} from '@conference/database';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedCustomer } from './customer-auth.service.js';
import type { DatabaseService } from './database.service.js';
import { PartnerDistributionService } from './partner-distribution.service.js';
import type { RedisService } from './redis.service.js';

const persistent = process.env.PARTNER_TEST_DATABASE_URL ? describe : describe.skip;

persistent('partner profile versioning with real PostgreSQL', () => {
  let connection: ReturnType<typeof createDatabase>;

  beforeAll(() => {
    connection = createDatabase(process.env.PARTNER_TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  it('creates a new immutable row for every profile and privacy update', async () => {
    const db = connection.db;
    const organizationId = randomUUID();
    const customerUserId = randomUUID();
    const partnerId = randomUUID();
    const originalProfileId = randomUUID();

    await db.insert(organizations).values({
      id: organizationId,
      slug: `partner-profile-${organizationId}`,
      name: '合作伙伴资料版本测试',
    });
    await db.insert(customerUsers).values({
      id: customerUserId,
      organizationId,
      mobileE164: `+86139${organizationId.replaceAll('-', '').slice(0, 8)}`,
    });
    const [event] = await db
      .insert(events)
      .values({
        organizationId,
        slug: `partner-profile-event-${organizationId}`,
        name: '合作伙伴资料测试大会',
        shortName: '资料测试',
        tagline: '资料版本链验收',
        description: '验证合作伙伴资料使用不可变版本记录。',
        status: 'registration_open',
        startsAt: new Date('2027-11-01T01:00:00Z'),
        endsAt: new Date('2027-11-01T10:00:00Z'),
        timezone: 'Asia/Shanghai',
        venue: '测试会场',
        city: '深圳',
        address: '测试地址',
      })
      .returning();
    await db.insert(eventPartners).values({
      id: partnerId,
      organizationId,
      eventId: event!.id,
      customerUserId,
      publicSlug: `profile-${organizationId.slice(0, 8)}`,
    });
    await db.insert(eventPartnerProfileVersions).values({
      id: originalProfileId,
      partnerId,
      organizationId,
      eventId: event!.id,
      version: 1,
      displayName: '原始名称',
      visibleFields: DEFAULT_PARTNER_VISIBLE_FIELDS,
      posterFields: DEFAULT_PARTNER_POSTER_FIELDS,
      actorType: 'system',
    });

    const service = new PartnerDistributionService(
      { db } as DatabaseService,
      {} as RedisService,
    );
    const session = {
      sessionId: randomUUID(),
      customerUserId,
      organizationId,
      tokenHash: 'test',
      expiresAt: new Date(Date.now() + 60_000),
      customer: {} as AuthenticatedCustomer['customer'],
      csrfToken: 'test',
    } satisfies AuthenticatedCustomer;

    const profileUpdated = await service.updateOwnProfile(session, event!.id, {
      expectedVersion: 1,
      displayName: '林知远',
      company: '远见增长实验室',
      title: '创始人',
      industry: '品牌增长与 GEO',
      businessIntro: '专注生成式搜索时代的品牌内容与增长策略。',
      businessUrl: 'https://example.com',
      contactPhone: '13800000000',
      contactEmail: 'partner@example.com',
      wechatId: 'tokems-partner',
      gallery: [],
    });
    const privacyUpdated = await service.updateOwnPrivacy(session, event!.id, {
      expectedVersion: profileUpdated.version,
      publicStatus: 'published',
      visibleFields: {
        ...DEFAULT_PARTNER_VISIBLE_FIELDS,
        businessUrl: true,
        contactPhone: true,
        contactEmail: true,
        wechatId: true,
      },
      posterFields: DEFAULT_PARTNER_POSTER_FIELDS,
      searchIndexingEnabled: false,
    });

    const versions = await db
      .select({ id: eventPartnerProfileVersions.id, version: eventPartnerProfileVersions.version })
      .from(eventPartnerProfileVersions)
      .where(eq(eventPartnerProfileVersions.partnerId, partnerId))
      .orderBy(asc(eventPartnerProfileVersions.version));

    expect(profileUpdated.profile.version).toBe(2);
    expect(privacyUpdated.profile.version).toBe(3);
    expect(privacyUpdated.profile.publicStatus).toBe('published');
    expect(versions.map((item) => item.version)).toEqual([1, 2, 3]);
    expect(new Set(versions.map((item) => item.id)).size).toBe(3);
    expect(versions[0]?.id).toBe(originalProfileId);
  });
});
