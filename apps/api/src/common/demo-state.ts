import type { Order, Registration, Ticket } from '@conference/contracts';
import { DEMO_EVENT } from '@conference/contracts';

const sampleAttendees = [
  ['王欣怡', '深圳云图科技有限公司', '品牌总监', 'confirmed'],
  ['李晨曦', '广州远望数字科技有限公司', '市场负责人', 'confirmed'],
  ['张雨桐', '南方新媒体研究院', '内容策略总监', 'pending_review'],
  ['刘子涵', '湾区智造科技有限公司', '产品市场经理', 'pending_payment'],
  ['陈思远', '深圳前海创投管理有限公司', '投资经理', 'confirmed'],
  ['赵嘉琪', '广东星河教育科技有限公司', '增长负责人', 'confirmed'],
  ['周明轩', '广州知行咨询有限公司', '高级顾问', 'pending_review'],
  ['吴若琳', '深圳海纳品牌管理有限公司', '客户总监', 'confirmed'],
  ['孙浩然', '大湾区产业观察中心', '行业研究员', 'pending_payment'],
  ['郭语彤', '珠江数字商业有限公司', '运营负责人', 'confirmed'],
] as const;

export function createDemoOperationalState() {
  const registrations = new Map<string, Registration>();
  const orders = new Map<string, Order>();
  const tickets = new Map<string, Ticket>();
  const now = Date.now();

  sampleAttendees.forEach(([name, company, title, status], index) => {
    const registrationId = `demo-registration-${index + 1}`;
    const registrationCode = `TOK-R-${String(index + 1).padStart(5, '0')}`;
    const ticketType = DEMO_EVENT.tickets[index % DEMO_EVENT.tickets.length]!;
    const registration: Registration = {
      id: registrationId,
      eventId: DEMO_EVENT.id,
      registrationCode,
      status,
      attendee: {
        name,
        mobile: `1380000${String(2101 + index)}`,
        email: `attendee${index + 1}@example.test`,
        company,
        title,
        city: index % 2 === 0 ? '深圳' : '广州',
      },
      ticketType,
      createdAt: new Date(now - index * 86_400_000).toISOString(),
    };
    registrations.set(registration.id, registration);

    const order: Order = {
      id: `demo-order-${index + 1}`,
      orderNo: `TOK2026${String(index + 1).padStart(6, '0')}`,
      registrationId,
      status:
        status === 'confirmed'
          ? 'paid'
          : status === 'pending_review'
            ? 'pending_review'
            : 'pending_payment',
      amount: ticketType.price,
      currency: ticketType.currency,
      paymentMethod: 'wechat',
      expiresAt: new Date(now + 900_000).toISOString(),
      createdAt: registration.createdAt,
    };
    orders.set(order.id, order);

    if (order.status === 'paid') {
      const ticketCode = `TOK-T-${String(index + 1).padStart(10, '0')}`;
      const ticket: Ticket = {
        id: `demo-ticket-${index + 1}`,
        code: ticketCode,
        registrationId,
        eventName: DEMO_EVENT.name,
        attendeeName: name,
        ticketTypeName: ticketType.name,
        qrPayload: `conference:${DEMO_EVENT.id}:${ticketCode}`,
        status: 'valid',
        issuedAt: order.createdAt,
      };
      tickets.set(ticket.code, ticket);
    }
  });

  return {
    registrations,
    orders,
    tickets,
    checkins: new Map<string, { ticketCode: string; checkedInAt: string; deviceId: string }>(),
    idempotency: new Map<string, unknown>(),
    ticketRemaining: new Map(DEMO_EVENT.tickets.map((ticket) => [ticket.id, ticket.remaining])),
  };
}

export type DemoOperationalState = ReturnType<typeof createDemoOperationalState>;
