import { randomUUID } from 'node:crypto';
import { organizations, paymentNotificationInbox } from '@conference/database';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ConferenceRepository } from './conference.repository.js';
import { DatabaseService } from './database.service.js';
import { WeChatPayService } from './wechat-pay.service.js';

const describePersistent = process.env.DATABASE_URL ? describe : describe.skip;

describePersistent('WeChat payment maintenance', () => {
  const database = new DatabaseService();
  const repository = {
    confirmPayment: vi.fn(),
  } as unknown as ConferenceRepository;
  const service = new WeChatPayService(database, undefined, repository);
  const organizationIds: string[] = [];

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await database.db!.delete(organizations).where(eq(organizations.id, organizationId));
    }
    await database.onModuleDestroy();
  });

  it('reclaims a stale processing inbox lease while preserving a live lease', async () => {
    const [organization] = await database
      .db!.insert(organizations)
      .values({
        slug: `payment-maintenance-${randomUUID()}`,
        name: 'Payment maintenance test',
      })
      .returning({ id: organizations.id });
    organizationIds.push(organization!.id);

    const [stale] = await database
      .db!.insert(paymentNotificationInbox)
      .values({
        organizationId: organization!.id,
        notificationId: `stale-${randomUUID()}`,
        outTradeNo: 'STALEPAYMENT01',
        eventType: 'TRANSACTION.SUCCESS',
        status: 'processing',
        payload: { externalId: 'transaction-stale' },
        updatedAt: new Date(Date.now() - 120_000),
      })
      .returning({ id: paymentNotificationInbox.id });
    const [live] = await database
      .db!.insert(paymentNotificationInbox)
      .values({
        organizationId: organization!.id,
        notificationId: `live-${randomUUID()}`,
        outTradeNo: 'LIVEPAYMENT001',
        eventType: 'TRANSACTION.SUCCESS',
        status: 'processing',
        payload: { externalId: 'transaction-live' },
        updatedAt: new Date(),
      })
      .returning({ id: paymentNotificationInbox.id });

    await service.processPaymentNotificationAsync(stale!.id);
    await service.processPaymentNotificationAsync(live!.id);

    const [staleResult] = await database
      .db!.select()
      .from(paymentNotificationInbox)
      .where(eq(paymentNotificationInbox.id, stale!.id));
    const [liveResult] = await database
      .db!.select()
      .from(paymentNotificationInbox)
      .where(eq(paymentNotificationInbox.id, live!.id));

    expect(staleResult).toMatchObject({
      status: 'dead',
      attemptCount: 1,
      lastError: 'Missing orderId or externalId',
    });
    expect(liveResult).toMatchObject({ status: 'processing', attemptCount: 0 });
    expect(repository.confirmPayment).not.toHaveBeenCalled();
  });
});
