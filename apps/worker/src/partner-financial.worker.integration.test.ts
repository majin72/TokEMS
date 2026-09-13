import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  customerUsers,
  eventPartnerProgramVersions,
  eventPartners,
  events,
  orderItems,
  orders,
  organizations,
  partnerAttributionRevisions,
  partnerCommissionItems,
  partnerCommissions,
  partnerFinancialEventInbox,
  partnerLedgerEntries,
  partnerPayoutBatches,
  partnerPayoutExecutions,
  partnerPayoutRecipients,
  partnerPayoutRequests,
  partnerReferralLinks,
  partnerReferralVisitDays,
  partnerReconciliationRuns,
  payments,
  refundItemAllocations,
  refunds,
  registrations,
  ticketTypes,
  type ConferenceDatabase,
} from '@conference/database';
import { and, eq, sql, sum } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  processPartnerFinancialInbox,
  reconcilePartnerFinancialFacts,
  releasePartnerCommissions,
} from './partner-financial.worker.js';

const persistent = process.env.PARTNER_TEST_DATABASE_URL ? describe : describe.skip;

async function financialFixture(db: ConferenceDatabase, zeroInitialRate = false) {
  const organizationId = randomUUID();
  const partnerCustomerId = randomUUID();
  const purchaserCustomerId = randomUUID();
  await db.insert(organizations).values({
    id: organizationId,
    slug: `financial-regression-${organizationId}`,
    name: '佣金恢复回归测试',
  });
  onTestFinished(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set constraints all deferred`);
      await tx
        .update(payments)
        .set({ partnerAttributionRevisionId: null })
        .where(
          sql`${payments.orderId} in (select id from orders where organization_id = ${organizationId})`,
        );
      for (const table of [
        refundItemAllocations,
        refunds,
        partnerLedgerEntries,
        partnerCommissionItems,
        partnerCommissions,
        partnerAttributionRevisions,
        partnerFinancialEventInbox,
        partnerReconciliationRuns,
        partnerReferralLinks,
        eventPartners,
        eventPartnerProgramVersions,
        orderItems,
      ]) {
        await tx.delete(table).where(eq(table.organizationId, organizationId));
      }
      await tx.delete(events).where(eq(events.organizationId, organizationId));
      await tx.delete(customerUsers).where(eq(customerUsers.organizationId, organizationId));
      await tx.delete(organizations).where(eq(organizations.id, organizationId));
    });
  });
  await db.insert(customerUsers).values([
    { id: partnerCustomerId, organizationId, mobileE164: '+8613811111111' },
    { id: purchaserCustomerId, organizationId, mobileE164: '+8613822222222' },
  ]);
  const [event] = await db
    .insert(events)
    .values({
      organizationId,
      slug: `financial-${organizationId}`,
      name: '佣金恢复测试大会',
      shortName: '佣金恢复',
      tagline: '恢复验收',
      description: '验证序号、阶梯与退款事务。',
      status: 'registration_open',
      startsAt: new Date('2027-10-01T01:00:00Z'),
      endsAt: new Date('2027-10-01T10:00:00Z'),
      timezone: 'Asia/Shanghai',
      venue: '测试会场',
      city: '上海',
      address: '测试地址',
    })
    .returning();
  const [ticket] = await db
    .insert(ticketTypes)
    .values({
      organizationId,
      eventId: event!.id,
      code: 'FINANCIAL',
      name: '测试票',
      description: '测试票',
      price: 10_000,
      currency: 'CNY',
      capacity: 100,
    })
    .returning();
  const [program] = await db
    .insert(eventPartnerProgramVersions)
    .values({
      organizationId,
      eventId: event!.id,
      version: 1,
      status: 'active',
      mode: 'order_count_tiered',
      fixedRateBps: zeroInitialRate ? 0 : 1000,
      tiers: [
        { minimumOrderCount: 2, rateBps: zeroInitialRate ? 1000 : 2000 },
        { minimumOrderCount: 4, rateBps: 3000 },
      ],
      settlementDelayDays: 0,
      termsTitle: '测试规则',
      termsContent: '全额退款撤销阶梯计数，历史比例保留。',
      promotionPolicy: '测试推广规范。',
      contentHash: '0'.repeat(64),
    })
    .returning();
  const [partner] = await db
    .insert(eventPartners)
    .values({
      organizationId,
      eventId: event!.id,
      customerUserId: partnerCustomerId,
      publicSlug: `financial-${organizationId.slice(0, 8)}`,
      qualificationStatus: 'active',
      attributionEnabled: true,
      currentProgramVersionId: program!.id,
      acceptedProgramVersionId: program!.id,
    })
    .returning();
  const [link] = await db
    .insert(partnerReferralLinks)
    .values({
      organizationId,
      eventId: event!.id,
      partnerId: partner!.id,
      code: `financial-${organizationId}`,
      destinationPath: `/register?event=${event!.slug}`,
    })
    .returning();
  let attendeeSequence = 0;
  const createPaidOrder = async () => {
    const identity = randomUUID().replaceAll('-', '');
    const attendeeMobile = `13833${String(++attendeeSequence).padStart(6, '0')}`;
    const [registration] = await db
      .insert(registrations)
      .values({
        organizationId,
        eventId: event!.id,
        ticketTypeId: ticket!.id,
        registrationCode: `FR${identity.slice(0, 20)}`,
        status: 'confirmed',
        attendee: {
          name: '参会人',
          mobile: attendeeMobile,
          email: `${identity}@example.test`,
          company: '测试公司',
          title: '测试职位',
          city: '上海',
        },
        attendeeMobileE164: `+86${attendeeMobile}`,
        attendeeEmailNormalized: `${identity}@example.test`,
      })
      .returning();
    return db.transaction(async (tx) => {
      await tx.execute(sql`set constraints all deferred`);
      const [order] = await tx
        .insert(orders)
        .values({
          organizationId,
          eventId: event!.id,
          registrationId: registration!.id,
          modelVersion: 2,
          quantity: 1,
          purchaserCustomerUserId: purchaserCustomerId,
          purchaseIntentId: randomUUID(),
          purchaserSnapshot: {
            customerUserId: purchaserCustomerId,
            mobile: '+8613822222222',
            name: '购买人',
            email: 'buyer@example.test',
            company: '测试公司',
            title: '采购',
            city: '上海',
          },
          orderNo: `FO${identity.slice(0, 20)}`,
          status: 'paid',
          amount: 10_000,
          currency: 'CNY',
          pricingSnapshot: { refundPolicy: { enabled: false } },
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning();
      const [item] = await tx
        .insert(orderItems)
        .values({
          orderId: order!.id,
          registrationId: registration!.id,
          organizationId,
          eventId: event!.id,
          position: 1,
          ticketTypeId: ticket!.id,
          unitPrice: 10_000,
          allocatedAmount: 10_000,
          pricingSnapshot: { unitPrice: 10_000 },
          state: 'active',
        })
        .returning();
      const [attribution] = await tx
        .insert(partnerAttributionRevisions)
        .values({
          organizationId,
          eventId: event!.id,
          orderId: order!.id,
          purchaseIntentId: order!.purchaseIntentId,
          orderVersion: order!.version,
          partnerId: partner!.id,
          referralLinkId: link!.id,
          programVersionId: program!.id,
          decision: 'attributed',
          decisionReason: '测试有效来源',
          attributionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
          purchaserCustomerUserId: purchaserCustomerId,
          orderSnapshot: { quantity: 1, amount: 10_000, currency: 'CNY' },
          createdBy: 'checkout',
        })
        .returning();
      const [payment] = await tx
        .insert(payments)
        .values({
          orderId: order!.id,
          partnerAttributionRevisionId: attribution!.id,
          provider: 'partner-test',
          status: 'succeeded',
          amount: 10_000,
          currency: 'CNY',
          succeededAt: new Date(Date.now() - 10 * 24 * 60 * 60_000),
        })
        .returning();
      await tx
        .update(orders)
        .set({ settledPaymentId: payment!.id })
        .where(eq(orders.id, order!.id));
      await tx.insert(partnerFinancialEventInbox).values({
        organizationId,
        eventId: event!.id,
        eventType: 'PaymentSucceeded',
        eventKey: `financial-payment:${payment!.id}`,
        payload: { orderId: order!.id },
      });
      return { order: order!, item: item!, payment: payment! };
    });
  };
  const refundOrder = async (paid: Awaited<ReturnType<typeof createPaidOrder>>) => {
    const [refund] = await db
      .insert(refunds)
      .values({
        organizationId,
        eventId: event!.id,
        orderId: paid.order.id,
        paymentId: paid.payment.id,
        refundNo: `FF${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        amount: paid.order.amount,
        currency: 'CNY',
        status: 'succeeded',
        reason: '全额退款恢复测试',
        idempotencyKey: `financial-refund:${paid.order.id}`,
      })
      .returning();
    await db.insert(refundItemAllocations).values({
      refundId: refund!.id,
      paymentId: paid.payment.id,
      orderId: paid.order.id,
      orderItemId: paid.item.id,
      organizationId,
      eventId: event!.id,
      amount: paid.order.amount,
      basis: '全额退款恢复测试',
    });
    const [inbox] = await db
      .insert(partnerFinancialEventInbox)
      .values({
        organizationId,
        eventId: event!.id,
        eventType: 'RefundSucceeded',
        eventKey: `financial-refund:${refund!.id}`,
        payload: { refundId: refund!.id },
      })
      .returning();
    return inbox!;
  };
  return { partner: partner!, createPaidOrder, refundOrder };
}

function interruptNextCommissionSummary(db: ConferenceDatabase): ConferenceDatabase {
  let pending = true;
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(target, property, receiver) {
        const method = Reflect.get(target, property, receiver);
        if (typeof method !== 'function') return method;
        if (property === 'transaction') {
          return (callback: (tx: object) => Promise<unknown>, ...args: unknown[]) =>
            method.call(target, (tx: object) => callback(wrap(tx)), ...args);
        }
        if (property === 'update') {
          return (table: unknown) => {
            if (pending && table === partnerCommissions) {
              pending = false;
              throw new Error('Injected interruption before commission summary write');
            }
            return method.call(target, table);
          };
        }
        return method.bind(target);
      },
    });
  return wrap(db);
}

persistent('partner financial ledger with real PostgreSQL', () => {
  let connection: ReturnType<typeof createDatabase>;

  beforeAll(() => {
    connection = createDatabase(process.env.PARTNER_TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  it('keeps immutable sequence numbers while full refunds remove tier counts', async () => {
    const db = connection.db;
    const fixture = await financialFixture(db);
    const first = await fixture.createPaidOrder();
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    await fixture.refundOrder(first);
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const second = await fixture.createPaidOrder();
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const third = await fixture.createPaidOrder();
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const commissions = await db
      .select()
      .from(partnerCommissions)
      .where(eq(partnerCommissions.partnerId, fixture.partner.id))
      .orderBy(partnerCommissions.sequence);
    expect(
      commissions.map((row) => ({
        orderId: row.orderId,
        sequence: row.sequence,
        rate: row.rateBps,
      })),
    ).toEqual([
      { orderId: first.order.id, sequence: 1, rate: 1000 },
      { orderId: second.order.id, sequence: 2, rate: 1000 },
      { orderId: third.order.id, sequence: 3, rate: 2000 },
    ]);
  }, 30_000);

  it('counts zero-rate eligible orders and serializes concurrent tier allocation', async () => {
    const db = connection.db;
    const fixture = await financialFixture(db, true);
    await fixture.createPaidOrder();
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    await fixture.createPaidOrder();
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    await Promise.all([fixture.createPaidOrder(), fixture.createPaidOrder()]);
    const processed = await Promise.all([
      processPartnerFinancialInbox(db),
      processPartnerFinancialInbox(db),
    ]);
    expect(processed.reduce((total, value) => total + value, 0)).toBe(2);
    const commissions = await db
      .select()
      .from(partnerCommissions)
      .where(eq(partnerCommissions.partnerId, fixture.partner.id))
      .orderBy(partnerCommissions.sequence);
    expect(commissions.map((row) => [row.sequence, row.rateBps, row.commissionAmount])).toEqual([
      [1, 0, 0],
      [2, 1000, 1000],
      [3, 1000, 1000],
      [4, 3000, 3000],
    ]);
  }, 30_000);

  it('replays a refund interrupted before its summary without releasing reversed funds', async () => {
    const db = connection.db;
    const fixture = await financialFixture(db);
    const paid = await fixture.createPaidOrder();
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const inbox = await fixture.refundOrder(paid);
    expect(await processPartnerFinancialInbox(interruptNextCommissionSummary(db))).toBe(0);
    const [failed] = await db
      .select()
      .from(partnerFinancialEventInbox)
      .where(eq(partnerFinancialEventInbox.id, inbox.id));
    expect(failed?.status).toBe('retrying');
    expect(failed?.lastError).toContain('Injected interruption');
    await db
      .update(partnerFinancialEventInbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(partnerFinancialEventInbox.id, inbox.id));
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const [commission] = await db
      .select()
      .from(partnerCommissions)
      .where(eq(partnerCommissions.orderId, paid.order.id));
    expect(commission).toMatchObject({
      reversedAmount: 1000,
      eligibleAmount: 0,
      status: 'reversed',
    });
    await releasePartnerCommissions(db);
    const balances = await db
      .select({
        bucket: partnerLedgerEntries.balanceBucket,
        amount: sum(partnerLedgerEntries.amount),
      })
      .from(partnerLedgerEntries)
      .where(eq(partnerLedgerEntries.partnerId, fixture.partner.id))
      .groupBy(partnerLedgerEntries.balanceBucket);
    expect(Object.fromEntries(balances.map((row) => [row.bucket, Number(row.amount)]))).toEqual({
      pending: 0,
    });
    const reversals = await db
      .select()
      .from(partnerLedgerEntries)
      .where(
        and(
          eq(partnerLedgerEntries.partnerId, fixture.partner.id),
          eq(partnerLedgerEntries.entryType, 'refund_reversal'),
        ),
      );
    expect(reversals).toHaveLength(1);
  }, 30_000);

  it('honors a settlement hold applied after selecting due commissions', async () => {
    const db = connection.db;
    const fixture = await financialFixture(db);
    await fixture.createPaidOrder();
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    let holdPending = true;
    const heldAfterSelection = new Proxy(db, {
      get(target, property, receiver) {
        const method = Reflect.get(target, property, receiver);
        if (property === 'transaction') {
          return async (...args: Parameters<typeof db.transaction>) => {
            if (holdPending) {
              holdPending = false;
              await db
                .update(eventPartners)
                .set({ settlementHold: true })
                .where(eq(eventPartners.id, fixture.partner.id));
            }
            return method.apply(target, args);
          };
        }
        return typeof method === 'function' ? method.bind(target) : method;
      },
    });
    expect(await releasePartnerCommissions(heldAfterSelection)).toBe(0);
    const [commission] = await db
      .select()
      .from(partnerCommissions)
      .where(eq(partnerCommissions.partnerId, fixture.partner.id));
    expect(commission).toMatchObject({ status: 'pending', availableAt: null });
  }, 30_000);

  it('removes a zero-rate order from tier counts when the partner claims its attendee', async () => {
    const db = connection.db;
    const fixture = await financialFixture(db, true);
    const first = await fixture.createPaidOrder();
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    await db
      .update(registrations)
      .set({ customerUserId: fixture.partner.customerUserId })
      .where(eq(registrations.id, first.item.registrationId));
    await db.insert(partnerFinancialEventInbox).values({
      organizationId: fixture.partner.organizationId,
      eventId: fixture.partner.eventId,
      eventType: 'PartnerAttendeeClaimed',
      eventKey: `zero-rate-claim:${first.item.id}`,
      payload: { orderItemId: first.item.id, customerUserId: fixture.partner.customerUserId },
    });
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const second = await fixture.createPaidOrder();
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const [claimed] = await db
      .select()
      .from(partnerCommissionItems)
      .where(eq(partnerCommissionItems.orderItemId, first.item.id));
    expect(claimed).toMatchObject({ eligibility: 'self_attendee', eligibleAmount: 0 });
    const [commission] = await db
      .select()
      .from(partnerCommissions)
      .where(eq(partnerCommissions.orderId, second.order.id));
    expect(commission).toMatchObject({ sequence: 2, rateBps: 0, commissionAmount: 0 });
  }, 30_000);

  it('creates one commission with five lines and recovers post-reservation reversals once', async () => {
    const db = connection.db;
    const organizationId = randomUUID();
    const partnerCustomerId = randomUUID();
    const purchaserCustomerId = randomUUID();
    const paidAt = new Date(Date.now() - 10 * 24 * 60 * 60_000);
    await db.insert(organizations).values({
      id: organizationId,
      slug: `partner-test-${organizationId}`,
      name: '合作伙伴账本测试',
    });
    await db.insert(customerUsers).values([
      { id: partnerCustomerId, organizationId, mobileE164: '+8613811111111' },
      { id: purchaserCustomerId, organizationId, mobileE164: '+8613822222222' },
    ]);
    const [event] = await db
      .insert(events)
      .values({
        organizationId,
        slug: `partner-event-${organizationId}`,
        name: '合作伙伴测试大会',
        shortName: '伙伴测试',
        tagline: '财务链路验收',
        description: '验证批量订单、退款与认领冲正。',
        status: 'registration_open',
        startsAt: new Date('2027-10-01T01:00:00Z'),
        endsAt: new Date('2027-10-01T10:00:00Z'),
        timezone: 'Asia/Shanghai',
        venue: '测试会场',
        city: '上海',
        address: '测试地址',
      })
      .returning();
    const [ticketType] = await db
      .insert(ticketTypes)
      .values({
        organizationId,
        eventId: event!.id,
        code: 'PARTNER-TEST',
        name: '伙伴测试票',
        description: '伙伴测试票',
        price: 10_000,
        currency: 'CNY',
        capacity: 100,
        sold: 5,
      })
      .returning();
    const registrationRows = await db
      .insert(registrations)
      .values(
        Array.from({ length: 5 }, (_, index) => ({
          organizationId,
          eventId: event!.id,
          ticketTypeId: ticketType!.id,
          registrationCode: `PR${organizationId.slice(0, 8)}${index}`,
          status: 'confirmed' as const,
          attendee: {
            name: `参会人${index + 1}`,
            mobile: `1380000000${index}`,
            email: `attendee-${index}@example.test`,
            company: '测试公司',
            title: '测试职位',
            city: '上海',
          },
          attendeeMobileE164: `+861380000000${index}`,
          attendeeEmailNormalized: `attendee-${index}@example.test`,
        })),
      )
      .returning();
    const purchaseIntentId = randomUUID();
    const { order, itemRows } = await db.transaction(async (tx) => {
      await tx.execute(sql`set constraints all deferred`);
      const [createdOrder] = await tx
        .insert(orders)
        .values({
          organizationId,
          eventId: event!.id,
          modelVersion: 2,
          quantity: 5,
          purchaserCustomerUserId: purchaserCustomerId,
          purchaseIntentId,
          purchaserSnapshot: {
            customerUserId: purchaserCustomerId,
            mobile: '+8613822222222',
            name: '购买人',
            email: 'buyer@example.test',
            company: '购买方',
            title: '采购',
            city: '上海',
          },
          orderNo: `PO${organizationId.replaceAll('-', '').slice(0, 20)}`,
          status: 'paid',
          amount: 50_000,
          currency: 'CNY',
          pricingSnapshot: { refundPolicy: { enabled: false } },
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning();
      const createdItems = await tx
        .insert(orderItems)
        .values(
          registrationRows.map((registration, index) => ({
            orderId: createdOrder!.id,
            registrationId: registration.id,
            organizationId,
            eventId: event!.id,
            position: index + 1,
            ticketTypeId: ticketType!.id,
            unitPrice: 10_000,
            allocatedAmount: 10_000,
            pricingSnapshot: { unitPrice: 10_000 },
            state: 'active' as const,
          })),
        )
        .returning();
      return { order: createdOrder!, itemRows: createdItems };
    });
    const [program] = await db
      .insert(eventPartnerProgramVersions)
      .values({
        organizationId,
        eventId: event!.id,
        version: 1,
        status: 'active',
        mode: 'fixed',
        fixedRateBps: 1000,
        attributionDays: 30,
        settlementDelayDays: 0,
        minimumPayoutAmount: 1000,
        termsTitle: '测试规则',
        termsContent: '测试合作伙伴佣金规则。',
        promotionPolicy: '测试推广规范。',
        contentHash: '0'.repeat(64),
      })
      .returning();
    const [partner] = await db
      .insert(eventPartners)
      .values({
        organizationId,
        eventId: event!.id,
        customerUserId: partnerCustomerId,
        publicSlug: `partner-${organizationId.slice(0, 8)}`,
        qualificationStatus: 'active',
        attributionEnabled: true,
        currentProgramVersionId: program!.id,
        acceptedProgramVersionId: program!.id,
        activatedAt: new Date(),
      })
      .returning();
    const [link] = await db
      .insert(partnerReferralLinks)
      .values({
        organizationId,
        eventId: event!.id,
        partnerId: partner!.id,
        code: `ref-${organizationId}`,
        destinationPath: `/register/${event!.slug}`,
      })
      .returning();
    const [attribution] = await db
      .insert(partnerAttributionRevisions)
      .values({
        organizationId,
        eventId: event!.id,
        orderId: order!.id,
        purchaseIntentId,
        orderVersion: order!.version,
        partnerId: partner!.id,
        referralLinkId: link!.id,
        programVersionId: program!.id,
        decision: 'attributed',
        decisionReason: '测试有效主动点击',
        attributionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        purchaserCustomerUserId: purchaserCustomerId,
        orderSnapshot: { quantity: 5, amount: 50_000, currency: 'CNY' },
        createdBy: 'checkout',
      })
      .returning();
    const [payment] = await db
      .insert(payments)
      .values({
        orderId: order!.id,
        partnerAttributionRevisionId: attribution!.id,
        provider: 'partner-test',
        status: 'succeeded',
        amount: 50_000,
        currency: 'CNY',
        succeededAt: paidAt,
      })
      .returning();
    await db.update(orders).set({ settledPaymentId: payment!.id }).where(eq(orders.id, order!.id));
    await db.insert(partnerFinancialEventInbox).values({
      organizationId,
      eventId: event!.id,
      eventType: 'PaymentSucceeded',
      eventKey: `test-payment:${payment!.id}`,
      payload: { orderId: order!.id },
    });

    expect(await processPartnerFinancialInbox(db)).toBe(1);
    expect(await processPartnerFinancialInbox(db)).toBe(0);
    const commissionRows = await db
      .select()
      .from(partnerCommissions)
      .where(eq(partnerCommissions.orderId, order!.id));
    const commissionItemRows = await db
      .select()
      .from(partnerCommissionItems)
      .where(eq(partnerCommissionItems.commissionId, commissionRows[0]!.id));
    expect(commissionRows).toHaveLength(1);
    expect(commissionRows[0]!.sequence).toBe(1);
    expect(commissionRows[0]!.commissionAmount).toBe(5_000);
    expect(commissionItemRows).toHaveLength(5);
    expect(commissionItemRows.every((item) => item.commissionAmount === 1_000)).toBe(true);

    expect(await releasePartnerCommissions(db)).toBe(1);
    await db.insert(partnerLedgerEntries).values([
      {
        organizationId,
        eventId: event!.id,
        partnerId: partner!.id,
        entryType: 'payout_reservation',
        balanceBucket: 'available',
        amount: -5_000,
        businessKey: `test-reservation:${partner!.id}:available`,
        reason: '测试提现占用',
      },
      {
        organizationId,
        eventId: event!.id,
        partnerId: partner!.id,
        entryType: 'payout_reservation',
        balanceBucket: 'reserved',
        amount: 5_000,
        businessKey: `test-reservation:${partner!.id}:reserved`,
        reason: '测试提现占用',
      },
    ]);

    const [recipient] = await db
      .insert(partnerPayoutRecipients)
      .values({
        organizationId,
        partnerId: partner!.id,
        customerUserId: partnerCustomerId,
        type: 'individual',
        channel: 'wechat_transfer',
        status: 'verified',
        displayNameCiphertext: 'sealed-name',
        accountReferenceCiphertext: 'sealed-account',
        accountFingerprint: 'f'.repeat(64),
        appId: 'wx-partner-test',
        openIdCiphertext: 'sealed-openid',
        verifiedAt: new Date(),
      })
      .returning();
    const [otherPartner] = await db
      .insert(eventPartners)
      .values({
        organizationId,
        eventId: event!.id,
        customerUserId: purchaserCustomerId,
        publicSlug: `partner-other-${organizationId.slice(0, 8)}`,
        qualificationStatus: 'active',
        attributionEnabled: true,
        currentProgramVersionId: program!.id,
        acceptedProgramVersionId: program!.id,
        activatedAt: new Date(),
      })
      .returning();
    const [otherRecipient] = await db
      .insert(partnerPayoutRecipients)
      .values({
        organizationId,
        partnerId: otherPartner!.id,
        customerUserId: purchaserCustomerId,
        type: 'individual',
        channel: 'wechat_transfer',
        status: 'verified',
        displayNameCiphertext: 'sealed-other-name',
        accountReferenceCiphertext: 'sealed-other-account',
        accountFingerprint: 'e'.repeat(64),
        appId: 'wx-partner-test',
        openIdCiphertext: 'sealed-other-openid',
        verifiedAt: new Date(),
      })
      .returning();
    await expect(
      db.insert(partnerPayoutRequests).values({
        organizationId,
        eventId: event!.id,
        partnerId: partner!.id,
        recipientId: otherRecipient!.id,
        status: 'submitted',
        grossAmount: 1_000,
        netAmount: 1_000,
        idempotencyKey: `invalid-recipient-scope:${organizationId}`,
        settlementSnapshot: { source: 'scope-test' },
        recipientVersion: otherRecipient!.version,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(partnerReferralVisitDays).values({
        organizationId,
        eventId: event!.id,
        partnerId: otherPartner!.id,
        referralLinkId: link!.id,
        localDate: '2026-09-13',
        visits: 1,
        uniqueVisits: 1,
        timezoneSnapshot: 'Asia/Shanghai',
      }),
    ).rejects.toThrow();
    const [batch] = await db
      .insert(partnerPayoutBatches)
      .values({
        organizationId,
        eventId: event!.id,
        channel: 'wechat_transfer',
        status: 'executing',
        cutoffAt: new Date(),
        requestCount: 1,
        grossAmount: 1_000,
        taxAmount: 100,
        netAmount: 900,
        budgetReservedAmount: 900,
        idempotencyKey: `callback-batch:${organizationId}`,
      })
      .returning();
    const [payoutRequest] = await db
      .insert(partnerPayoutRequests)
      .values({
        organizationId,
        eventId: event!.id,
        partnerId: partner!.id,
        recipientId: recipient!.id,
        batchId: batch!.id,
        status: 'executing',
        grossAmount: 1_000,
        taxAmount: 100,
        netAmount: 900,
        idempotencyKey: `callback-request:${organizationId}`,
        settlementSnapshot: { source: 'partner-worker-test' },
        recipientVersion: recipient!.version,
        userConfirmedAt: new Date(),
      })
      .returning();
    const [execution] = await db
      .insert(partnerPayoutExecutions)
      .values({
        organizationId,
        eventId: event!.id,
        partnerId: partner!.id,
        payoutRequestId: payoutRequest!.id,
        batchId: batch!.id,
        channel: 'wechat_transfer',
        status: 'PROCESSING',
        jobType: '大会推广伙伴',
        remunerationDescription: '大会推广佣金',
        amount: 900,
        recipientVersion: recipient!.version,
        merchantBillNo: `CALLBACK${organizationId.replaceAll('-', '').slice(0, 20)}`,
        recipientSnapshot: { recipientId: recipient!.id },
        requestSnapshot: { transfer_amount: 900 },
      })
      .returning();
    await db.insert(partnerLedgerEntries).values([
      {
        organizationId,
        eventId: event!.id,
        partnerId: partner!.id,
        entryType: 'manual_adjustment',
        balanceBucket: 'available',
        amount: 1_000,
        businessKey: `callback:${payoutRequest!.id}:available-credit`,
        reason: '微信回调异步处理测试资金',
      },
      {
        organizationId,
        eventId: event!.id,
        partnerId: partner!.id,
        payoutRequestId: payoutRequest!.id,
        entryType: 'payout_reservation',
        balanceBucket: 'available',
        amount: -1_000,
        businessKey: `callback:${payoutRequest!.id}:available-reserve`,
        reason: '微信回调异步处理测试占用',
      },
      {
        organizationId,
        eventId: event!.id,
        partnerId: partner!.id,
        payoutRequestId: payoutRequest!.id,
        entryType: 'payout_reservation',
        balanceBucket: 'reserved',
        amount: 1_000,
        businessKey: `callback:${payoutRequest!.id}:reserved`,
        reason: '微信回调异步处理测试占用',
      },
    ]);
    const callbackEventKey = `wechat-transfer-notification:${randomUUID()}`;
    await db.insert(partnerFinancialEventInbox).values({
      organizationId,
      eventId: event!.id,
      eventType: 'WechatTransferStateChanged',
      eventKey: callbackEventKey,
      payload: {
        executionId: execution!.id,
        state: 'SUCCESS',
        response: {
          out_bill_no: execution!.merchantBillNo,
          transfer_bill_no: '4200000000202609130000000001',
          state: 'SUCCESS',
        },
      },
    });
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const [settledPayout] = await db
      .select({ status: partnerPayoutRequests.status })
      .from(partnerPayoutRequests)
      .where(eq(partnerPayoutRequests.id, payoutRequest!.id));
    expect(settledPayout!.status).toBe('succeeded');
    await db
      .update(partnerFinancialEventInbox)
      .set({ status: 'retrying', processedAt: null, nextAttemptAt: new Date(0) })
      .where(eq(partnerFinancialEventInbox.eventKey, callbackEventKey));
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const [paidBalance] = await db
      .select({ value: sum(partnerLedgerEntries.amount) })
      .from(partnerLedgerEntries)
      .where(
        sql`${partnerLedgerEntries.partnerId} = ${partner!.id} and ${partnerLedgerEntries.balanceBucket} = 'paid'`,
      );
    expect(Number(paidBalance?.value ?? 0)).toBe(1_000);
    const paidBreakdown = await db
      .select({
        entryType: partnerLedgerEntries.entryType,
        value: sum(partnerLedgerEntries.amount),
      })
      .from(partnerLedgerEntries)
      .where(
        and(
          eq(partnerLedgerEntries.payoutRequestId, payoutRequest!.id),
          eq(partnerLedgerEntries.balanceBucket, 'paid'),
        ),
      )
      .groupBy(partnerLedgerEntries.entryType);
    expect(
      Object.fromEntries(paidBreakdown.map((row) => [row.entryType, Number(row.value ?? 0)])),
    ).toEqual({
      payout: 900,
      tax_withholding: 100,
    });

    const [refund] = await db
      .insert(refunds)
      .values({
        organizationId,
        eventId: event!.id,
        orderId: order!.id,
        paymentId: payment!.id,
        refundNo: `RF${organizationId.replaceAll('-', '').slice(0, 20)}`,
        amount: 5_000,
        currency: 'CNY',
        status: 'succeeded',
        reason: '部分退款测试',
        idempotencyKey: `partner-test-refund:${organizationId}`,
      })
      .returning();
    await db.insert(refundItemAllocations).values({
      refundId: refund!.id,
      paymentId: payment!.id,
      orderId: order!.id,
      orderItemId: itemRows[0]!.id,
      organizationId,
      eventId: event!.id,
      amount: 5_000,
      basis: '测试部分退款',
    });
    await db.insert(partnerFinancialEventInbox).values({
      organizationId,
      eventId: event!.id,
      eventType: 'RefundSucceeded',
      eventKey: `test-refund:${refund!.id}`,
      payload: { refundId: refund!.id },
    });
    await db
      .update(registrations)
      .set({ customerUserId: partnerCustomerId })
      .where(eq(registrations.id, registrationRows[0]!.id));
    await db.insert(partnerFinancialEventInbox).values({
      organizationId,
      eventId: event!.id,
      eventType: 'PartnerAttendeeClaimed',
      eventKey: `test-claim:${itemRows[0]!.id}`,
      payload: { orderItemId: itemRows[0]!.id, customerUserId: partnerCustomerId },
    });

    const concurrentProcessed = await Promise.all([
      processPartnerFinancialInbox(db),
      processPartnerFinancialInbox(db),
    ]);
    expect(concurrentProcessed.reduce((total, value) => total + value, 0)).toBe(2);
    expect(await processPartnerFinancialInbox(db)).toBe(0);
    const [recovery] = await db
      .select({ value: sum(partnerLedgerEntries.amount) })
      .from(partnerLedgerEntries)
      .where(
        sql`${partnerLedgerEntries.partnerId} = ${partner!.id} and ${partnerLedgerEntries.balanceBucket} = 'recovery_due'`,
      );
    const updatedItems = await db
      .select()
      .from(partnerCommissionItems)
      .where(eq(partnerCommissionItems.commissionId, commissionRows[0]!.id));
    expect(Number(recovery?.value ?? 0)).toBe(1_000);
    expect(updatedItems.find((item) => item.orderItemId === itemRows[0]!.id)?.refundedAmount).toBe(
      5_000,
    );
    expect(updatedItems.find((item) => item.orderItemId === itemRows[0]!.id)?.eligibility).toBe(
      'self_attendee',
    );
    const [recoveryCommission] = await db
      .select({ status: partnerCommissions.status })
      .from(partnerCommissions)
      .where(eq(partnerCommissions.id, commissionRows[0]!.id));
    expect(recoveryCommission!.status).toBe('recovery_due');

    await db
      .update(partnerFinancialEventInbox)
      .set({ status: 'retrying', processedAt: null, nextAttemptAt: new Date(0) })
      .where(eq(partnerFinancialEventInbox.eventKey, `test-refund:${refund!.id}`));
    const expiredLeaseKey = `test-expired-lease:${payment!.id}`;
    await db.insert(partnerFinancialEventInbox).values({
      organizationId,
      eventId: event!.id,
      eventType: 'PaymentSucceeded',
      eventKey: expiredLeaseKey,
      payload: { orderId: order!.id },
      status: 'processing',
      attempts: 1,
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(0),
    });
    expect(await processPartnerFinancialInbox(db)).toBe(2);
    const refundedItemId = updatedItems.find((item) => item.orderItemId === itemRows[0]!.id)!.id;
    const [replayedItem] = await db
      .select()
      .from(partnerCommissionItems)
      .where(eq(partnerCommissionItems.id, refundedItemId));
    const [replayedRecovery] = await db
      .select({ value: sum(partnerLedgerEntries.amount) })
      .from(partnerLedgerEntries)
      .where(
        sql`${partnerLedgerEntries.partnerId} = ${partner!.id} and ${partnerLedgerEntries.balanceBucket} = 'recovery_due'`,
      );
    const [recoveredLease] = await db
      .select({ status: partnerFinancialEventInbox.status })
      .from(partnerFinancialEventInbox)
      .where(eq(partnerFinancialEventInbox.eventKey, expiredLeaseKey));
    expect(replayedItem!.refundedAmount).toBe(5_000);
    expect(Number(replayedRecovery?.value ?? 0)).toBe(1_000);
    expect(recoveredLease!.status).toBe('processed');

    const [laterRegistration] = await db
      .insert(registrations)
      .values({
        organizationId,
        eventId: event!.id,
        ticketTypeId: ticketType!.id,
        registrationCode: `PR${organizationId.slice(0, 8)}L`,
        status: 'confirmed',
        attendee: {
          name: '后续参会人',
          mobile: '13800000099',
          email: 'later@example.test',
          company: '测试公司',
          title: '测试职位',
          city: '上海',
        },
        attendeeMobileE164: '+8613800000099',
        attendeeEmailNormalized: 'later@example.test',
      })
      .returning();
    const laterPurchaseIntentId = randomUUID();
    const { laterOrder, laterItem } = await db.transaction(async (tx) => {
      await tx.execute(sql`set constraints all deferred`);
      const [createdOrder] = await tx
        .insert(orders)
        .values({
          organizationId,
          eventId: event!.id,
          registrationId: laterRegistration!.id,
          modelVersion: 2,
          quantity: 1,
          purchaserCustomerUserId: purchaserCustomerId,
          purchaseIntentId: laterPurchaseIntentId,
          purchaserSnapshot: {
            customerUserId: purchaserCustomerId,
            mobile: '+8613822222222',
            name: '购买人',
            email: 'buyer@example.test',
            company: '购买方',
            title: '采购',
            city: '上海',
          },
          orderNo: `PL${organizationId.replaceAll('-', '').slice(0, 20)}`,
          status: 'paid',
          amount: 20_000,
          currency: 'CNY',
          pricingSnapshot: { refundPolicy: { enabled: false } },
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning();
      const [createdItem] = await tx
        .insert(orderItems)
        .values({
          orderId: createdOrder!.id,
          registrationId: laterRegistration!.id,
          organizationId,
          eventId: event!.id,
          position: 1,
          ticketTypeId: ticketType!.id,
          unitPrice: 20_000,
          allocatedAmount: 20_000,
          pricingSnapshot: { unitPrice: 20_000 },
          state: 'active',
        })
        .returning();
      return { laterOrder: createdOrder!, laterItem: createdItem! };
    });
    const [laterAttribution] = await db
      .insert(partnerAttributionRevisions)
      .values({
        organizationId,
        eventId: event!.id,
        orderId: laterOrder!.id,
        purchaseIntentId: laterPurchaseIntentId,
        orderVersion: laterOrder!.version,
        partnerId: partner!.id,
        referralLinkId: link!.id,
        programVersionId: program!.id,
        decision: 'attributed',
        decisionReason: '测试后续有效主动点击',
        attributionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        purchaserCustomerUserId: purchaserCustomerId,
        orderSnapshot: { quantity: 1, amount: 20_000, currency: 'CNY' },
        createdBy: 'checkout',
      })
      .returning();
    const [laterPayment] = await db
      .insert(payments)
      .values({
        orderId: laterOrder!.id,
        partnerAttributionRevisionId: laterAttribution!.id,
        provider: 'partner-test',
        status: 'succeeded',
        amount: 20_000,
        currency: 'CNY',
        succeededAt: paidAt,
      })
      .returning();
    await db
      .update(orders)
      .set({ settledPaymentId: laterPayment!.id })
      .where(eq(orders.id, laterOrder!.id));
    const [laterRefund] = await db
      .insert(refunds)
      .values({
        organizationId,
        eventId: event!.id,
        orderId: laterOrder!.id,
        paymentId: laterPayment!.id,
        refundNo: `RL${organizationId.replaceAll('-', '').slice(0, 20)}`,
        amount: 2_000,
        currency: 'CNY',
        status: 'succeeded',
        reason: '乱序退款测试',
        idempotencyKey: `partner-later-refund:${organizationId}`,
      })
      .returning();
    await db.insert(refundItemAllocations).values({
      refundId: laterRefund!.id,
      paymentId: laterPayment!.id,
      orderId: laterOrder!.id,
      orderItemId: laterItem.id,
      organizationId,
      eventId: event!.id,
      amount: 2_000,
      basis: '乱序退款测试',
    });
    const laterRefundEventKey = `test-later-refund:${laterRefund!.id}`;
    await db.insert(partnerFinancialEventInbox).values({
      organizationId,
      eventId: event!.id,
      eventType: 'RefundSucceeded',
      eventKey: laterRefundEventKey,
      payload: { refundId: laterRefund!.id },
    });
    await db.insert(partnerFinancialEventInbox).values({
      organizationId,
      eventId: event!.id,
      eventType: 'PaymentSucceeded',
      eventKey: `test-later-payment:${laterPayment!.id}`,
      payload: { orderId: laterOrder!.id },
    });
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    const [deferredRefund] = await db
      .select({ status: partnerFinancialEventInbox.status })
      .from(partnerFinancialEventInbox)
      .where(eq(partnerFinancialEventInbox.eventKey, laterRefundEventKey));
    expect(deferredRefund!.status).toBe('retrying');
    await db
      .update(partnerFinancialEventInbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(partnerFinancialEventInbox.eventKey, laterRefundEventKey));
    expect(await processPartnerFinancialInbox(db)).toBe(1);
    expect(await releasePartnerCommissions(db)).toBe(1);
    const [recoveredBalance] = await db
      .select({ value: sum(partnerLedgerEntries.amount) })
      .from(partnerLedgerEntries)
      .where(
        sql`${partnerLedgerEntries.partnerId} = ${partner!.id} and ${partnerLedgerEntries.balanceBucket} = 'recovery_due'`,
      );
    const [availableAfterRecovery] = await db
      .select({ value: sum(partnerLedgerEntries.amount) })
      .from(partnerLedgerEntries)
      .where(
        sql`${partnerLedgerEntries.partnerId} = ${partner!.id} and ${partnerLedgerEntries.balanceBucket} = 'available'`,
      );
    const [oldCommissionAfterRecovery] = await db
      .select({ status: partnerCommissions.status })
      .from(partnerCommissions)
      .where(eq(partnerCommissions.id, commissionRows[0]!.id));
    expect(Number(recoveredBalance?.value ?? 0)).toBe(0);
    expect(Number(availableAfterRecovery?.value ?? 0)).toBe(800);
    expect(oldCommissionAfterRecovery!.status).toBe('partially_reversed');

    await expect(reconcilePartnerFinancialFacts(db)).resolves.toEqual({
      missingPayments: 0,
      missingRefunds: 0,
    });
    await reconcilePartnerFinancialFacts(db);
    const reconciliationRows = await db
      .select()
      .from(partnerReconciliationRuns)
      .where(eq(partnerReconciliationRuns.eventId, event!.id));
    expect(reconciliationRows).toHaveLength(2);
    expect(reconciliationRows.map((item) => item.kind).sort()).toEqual(['payments', 'refunds']);
    expect(reconciliationRows.every((item) => item.status === 'matched')).toBe(true);
  }, 60_000);
});
