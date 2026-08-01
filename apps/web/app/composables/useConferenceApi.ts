import {
  DEMO_EVENT,
  type CreateRegistration,
  type Order,
  type PublicSiteConfiguration,
  type PublicEvent,
  type RegistrationCheckout,
  type SubmitInvoiceDetails,
  type Ticket,
  type WeChatNativePayment,
  type WaitlistEntry,
  type WaitlistJoin,
} from '@conference/contracts';
import { createLocalTicketIdentity } from '../utils/ticket-code';

type WebRegistrationCheckout = RegistrationCheckout & { ticket?: Ticket };
export interface WebInvoiceAccess {
  id: string;
  requestNo: string;
  status: 'awaiting_details';
  accessToken: string;
  expiresAt: string;
}

type PaymentResult = {
  order: Order;
  ticket: Ticket;
  invoice?: WebInvoiceAccess;
};

export function useConferenceApi() {
  const config = useRuntimeConfig();
  const baseURL = import.meta.server ? config.apiInternalBase : config.public.apiBase;
  const organizationSlug = config.public.organizationSlug;

  function isNetworkFailure(error: unknown) {
    const failure = error as { response?: { status?: number }; statusCode?: number };
    return !failure?.response?.status && !failure?.statusCode;
  }

  async function getEvent(slug = DEMO_EVENT.slug): Promise<PublicEvent> {
    try {
      const event = await $fetch<PublicEvent>(`/events/${slug}`, {
        baseURL,
        timeout: 4_000,
        headers: { 'X-Organization-Slug': organizationSlug },
      });
      saveEvent(event);
      return event;
    } catch (error) {
      if (import.meta.dev && isNetworkFailure(error)) {
        const event = structuredClone(DEMO_EVENT);
        saveEvent(event);
        return event;
      }
      throw error;
    }
  }

  async function getSiteConfiguration(): Promise<PublicSiteConfiguration> {
    try {
      return await $fetch<PublicSiteConfiguration>('/site-config', {
        baseURL,
        timeout: 4_000,
        headers: { 'X-Organization-Slug': organizationSlug },
      });
    } catch (error) {
      if (!import.meta.dev || !isNetworkFailure(error)) throw error;
      return {
        website: {
          siteName: '大会报名中心',
          seoTitle: '大会报名中心',
          seoDescription: '',
          faviconUrl: '',
          footerText: '',
          icpNumber: '',
          supportEmail: '',
        },
        analytics: {
          enabled: false,
          provider: 'baidu',
          trackingId: '',
          scriptUrl: '',
          siteId: '',
        },
        customerAccounts: {
          termsUrl: '',
          termsVersion: '',
          privacyUrl: '',
          privacyVersion: '',
        },
      };
    }
  }

  async function createRegistration(input: CreateRegistration): Promise<WebRegistrationCheckout> {
    const key = `registration-${crypto.randomUUID()}`;
    try {
      return await $fetch<WebRegistrationCheckout>('/registrations', {
        method: 'POST',
        baseURL,
        credentials: 'include',
        headers: {
          'Idempotency-Key': key,
          'X-Organization-Slug': organizationSlug,
        },
        body: input,
      });
    } catch (error) {
      if (import.meta.dev && isNetworkFailure(error)) return createLocalCheckout(input);
      throw error;
    }
  }

  async function joinWaitlist(input: WaitlistJoin): Promise<WaitlistEntry> {
    try {
      return await $fetch<WaitlistEntry>('/waitlist', {
        method: 'POST',
        baseURL,
        credentials: 'include',
        headers: {
          'Idempotency-Key': `waitlist-${crypto.randomUUID()}`,
          'X-Organization-Slug': organizationSlug,
        },
        body: input,
      });
    } catch (error) {
      if (import.meta.dev && isNetworkFailure(error)) {
        const ticket = DEMO_EVENT.tickets.find((item) => item.id === input.ticketTypeId);
        return {
          id: crypto.randomUUID(),
          eventId: input.eventId,
          ticketTypeId: input.ticketTypeId,
          ticketTypeName: ticket?.name ?? '大会门票',
          name: input.name,
          email: input.email,
          mobile: input.mobile,
          status: 'waiting',
          position: 1,
          invitedAt: null,
          expiresAt: null,
          createdAt: new Date().toISOString(),
        };
      }
      throw error;
    }
  }

  async function confirmPayment(order: Order, registrationId: string): Promise<PaymentResult> {
    try {
      return await $fetch<PaymentResult>(`/payments/mock/${order.id}/confirm`, {
        method: 'POST',
        baseURL,
        headers: { 'Idempotency-Key': `payment-${order.id}` },
      });
    } catch (error) {
      if (!import.meta.dev || !isNetworkFailure(error)) throw error;
      const ticketIdentity = createLocalTicketIdentity(DEMO_EVENT.id);
      const checkout = readCheckout();
      const ticket: Ticket = {
        id: crypto.randomUUID(),
        ...ticketIdentity,
        registrationId,
        eventName: DEMO_EVENT.name,
        attendeeName: checkout?.registration.attendee.name ?? '参会者',
        ticketTypeName: checkout?.registration.ticketType.name ?? '大会门票',
        status: 'valid',
        issuedAt: new Date().toISOString(),
      };
      return { order: { ...order, status: 'paid' as const }, ticket };
    }
  }

  function prepareWeChatNativePayment(
    orderId: string,
    accessToken: string,
  ): Promise<WeChatNativePayment> {
    return $fetch<WeChatNativePayment>(`/payments/wechat/${orderId}/native`, {
      method: 'POST',
      baseURL,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  async function submitInvoiceDetails(invoiceId: string, input: SubmitInvoiceDetails) {
    return $fetch<{ id: string; requestNo: string; status: string }>(
      `/invoices/${invoiceId}/details`,
      {
        method: 'POST',
        baseURL,
        body: input,
      },
    );
  }

  async function submitOrderInvoice(orderId: string, input: SubmitInvoiceDetails) {
    const { accessToken, ...details } = input;
    return $fetch<{ id: string; requestNo: string; status: string }>(
      `/orders/${orderId}/invoice-request`,
      {
        method: 'POST',
        baseURL,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: details,
      },
    );
  }

  async function getOrderInvoice(orderId: string, accessToken: string) {
    return $fetch<Record<string, unknown>>(`/orders/${orderId}/invoice-request`, {
      baseURL,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  async function requestOrderAccessLink(orderNo: string, email: string) {
    return $fetch<{ accepted: true; message: string }>('/orders/access-links', {
      method: 'POST',
      baseURL,
      body: { orderNo, email },
    });
  }

  async function getOrder(identifier: string, accessToken?: string) {
    try {
      return await $fetch<Order>(`/orders/${identifier}`, {
        baseURL,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
    } catch (error) {
      if (import.meta.dev && isNetworkFailure(error)) return readCheckout()?.order;
      throw error;
    }
  }

  async function getTicket(identifier: string) {
    try {
      return await $fetch<Ticket>(`/tickets/${identifier}`, { baseURL });
    } catch (error) {
      if (import.meta.dev && isNetworkFailure(error)) return readTicket(identifier);
      throw error;
    }
  }

  async function getOrderTicket(identifier: string, accessToken: string) {
    try {
      return await $fetch<Ticket>(`/orders/${identifier}/ticket`, {
        baseURL,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (error) {
      if (import.meta.dev && isNetworkFailure(error)) {
        const local = readCheckout()?.ticket;
        if (local) return local;
      }
      throw error;
    }
  }

  function createLocalCheckout(input: CreateRegistration): WebRegistrationCheckout {
    const localEvent = readEvent() ?? DEMO_EVENT;
    const ticket = localEvent.tickets.find((item) => item.id === input.ticketTypeId)!;
    const registrationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const isFree = ticket.price === 0;
    const issuedTicket: Ticket | undefined = isFree
      ? {
          id: crypto.randomUUID(),
          ...createLocalTicketIdentity(localEvent.id),
          registrationId,
          eventName: localEvent.name,
          attendeeName: input.attendee.name,
          ticketTypeName: ticket.name,
          status: 'valid',
          issuedAt: createdAt,
        }
      : undefined;
    return {
      registration: {
        id: registrationId,
        eventId: input.eventId,
        registrationCode: `TOK-R-${registrationId.slice(0, 8).toUpperCase()}`,
        status: isFree ? 'confirmed' : 'pending_payment',
        attendee: input.attendee,
        ticketType: ticket,
        createdAt,
      },
      order: {
        id: crypto.randomUUID(),
        orderNo: `TOK2026${Date.now().toString().slice(-10)}`,
        registrationId,
        status: isFree ? 'paid' : 'pending_payment',
        amount: ticket.price,
        currency: ticket.currency,
        paymentMethod: isFree ? 'free' : 'wechat',
        expiresAt: isFree ? createdAt : new Date(Date.now() + 15 * 60_000).toISOString(),
        createdAt,
      },
      orderAccessToken:
        crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
      ...(issuedTicket ? { ticket: issuedTicket } : {}),
    };
  }

  function readCheckout(): WebRegistrationCheckout | undefined {
    if (!import.meta.client) return undefined;
    const value = sessionStorage.getItem('conference.checkout');
    return value ? (JSON.parse(value) as WebRegistrationCheckout) : undefined;
  }

  function saveCheckout(checkout: WebRegistrationCheckout) {
    if (import.meta.client) sessionStorage.setItem('conference.checkout', JSON.stringify(checkout));
  }

  function readEvent(): PublicEvent | undefined {
    if (!import.meta.client) return undefined;
    const value = sessionStorage.getItem('conference.event');
    return value ? (JSON.parse(value) as PublicEvent) : undefined;
  }

  function saveEvent(event: PublicEvent) {
    if (import.meta.client) sessionStorage.setItem('conference.event', JSON.stringify(event));
  }

  function readTicket(identifier: string): Ticket | undefined {
    if (!import.meta.client) return undefined;
    const value = sessionStorage.getItem('conference.ticket');
    if (!value) return undefined;
    const ticket = JSON.parse(value) as Ticket;
    return ticket.code === identifier || ticket.registrationId === identifier ? ticket : undefined;
  }

  function saveTicket(ticket: Ticket) {
    if (import.meta.client) sessionStorage.setItem('conference.ticket', JSON.stringify(ticket));
  }

  function readInvoiceAccess(invoiceId?: string): WebInvoiceAccess | undefined {
    if (!import.meta.client) return undefined;
    const value = sessionStorage.getItem('conference.invoiceAccess');
    if (!value) return undefined;
    const access = JSON.parse(value) as WebInvoiceAccess;
    return !invoiceId || access.id === invoiceId ? access : undefined;
  }

  function saveInvoiceAccess(access: WebInvoiceAccess) {
    if (import.meta.client) {
      sessionStorage.setItem('conference.invoiceAccess', JSON.stringify(access));
    }
  }

  function clearInvoiceAccess() {
    if (import.meta.client) sessionStorage.removeItem('conference.invoiceAccess');
  }

  function invoiceDownloadUrl(path: string) {
    return `${String(baseURL).replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  }

  return {
    getEvent,
    getSiteConfiguration,
    createRegistration,
    joinWaitlist,
    confirmPayment,
    prepareWeChatNativePayment,
    getOrder,
    getTicket,
    getOrderTicket,
    readCheckout,
    saveCheckout,
    readEvent,
    saveEvent,
    readTicket,
    saveTicket,
    submitInvoiceDetails,
    submitOrderInvoice,
    getOrderInvoice,
    requestOrderAccessLink,
    readInvoiceAccess,
    saveInvoiceAccess,
    clearInvoiceAccess,
    invoiceDownloadUrl,
  };
}
