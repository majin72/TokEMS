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
  partnerReconciliationRuns,
  payments,
  refundItemAllocations,
  refunds,
  registrations,
  ticketTypes,
} from '@conference/database';
import { eq, sql, sum } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  processPartnerFinancialInbox,
  reconcilePartnerFinancialFacts,
  releasePartnerCommissions,
} from './partner-financial.worker.js';

const persistent = process.env.PARTNER_TEST_DATABASE_URL ? describe : describe.skip;

persistent('partner financial ledger with real PostgreSQL', () => {
  let connection: ReturnType<typeof createDatabase>;

  beforeAll(() => {
    connection = createDatabase(process.env.PARTNER_TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await connection.pool.end();
  });

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
        netAmount: 1_000,
        budgetReservedAmount: 1_000,
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
        netAmount: 1_000,
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
        amount: 1_000,
        recipientVersion: recipient!.version,
        merchantBillNo: `CALLBACK${organizationId.replaceAll('-', '').slice(0, 20)}`,
        recipientSnapshot: { recipientId: recipient!.id },
        requestSnapshot: { transfer_amount: 1_000 },
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
      .where(eq(registrations.id, registrationRows[1]!.id));
    await db.insert(partnerFinancialEventInbox).values({
      organizationId,
      eventId: event!.id,
      eventType: 'PartnerAttendeeClaimed',
      eventKey: `test-claim:${itemRows[1]!.id}`,
      payload: { orderItemId: itemRows[1]!.id, customerUserId: partnerCustomerId },
    });

    expect(await processPartnerFinancialInbox(db)).toBe(2);
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
    expect(Number(recovery?.value ?? 0)).toBe(1_500);
    expect(updatedItems.find((item) => item.orderItemId === itemRows[0]!.id)?.refundedAmount).toBe(5_000);
    expect(updatedItems.find((item) => item.orderItemId === itemRows[1]!.id)?.eligibility).toBe('self_attendee');

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
    expect(Number(replayedRecovery?.value ?? 0)).toBe(1_500);
    expect(recoveredLease!.status).toBe('processed');

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
