import type {
  CustomerCreateInvoice,
  CustomerInvoiceCenterCategory,
  CustomerInvoiceCenterList,
  CustomerInvoiceDetail,
  CustomerInvoiceOrderContext,
  CustomerInvoiceSendResult,
  CustomerRegistrationDetail,
  CustomerRegistrationList,
  CustomerSession,
  CustomerUpdateInvoice,
  RequestCustomerOtpResult,
  UpdateCustomerProfile,
} from '@conference/contracts';

export function useCustomerSession() {
  const config = useRuntimeConfig();
  const session = useState<CustomerSession | null>('customer-session', () => null);
  const loaded = useState('customer-session-loaded', () => false);
  const refreshInFlight = useState<Promise<CustomerSession | null> | null>(
    'customer-session-refresh-in-flight',
    () => null,
  );
  const authDialogOpen = useState('customer-auth-dialog-open', () => false);
  const baseURL = import.meta.server ? config.apiInternalBase : config.public.apiBase;
  const organizationSlug = config.public.organizationSlug;

  function headers(mutation = false) {
    return {
      'X-Organization-Slug': organizationSlug,
      ...(mutation && session.value?.csrfToken ? { 'X-CSRF-Token': session.value.csrfToken } : {}),
    };
  }

  async function refresh(force = false) {
    if (loaded.value && !force) return session.value;
    if (refreshInFlight.value) return refreshInFlight.value;
    refreshInFlight.value = (async () => {
      const result = await $fetch<CustomerSession | { authenticated: false }>(
        '/customer-auth/session',
        {
          baseURL,
          credentials: 'include',
          headers: headers(),
        },
      );
      session.value = result.authenticated ? result : null;
      loaded.value = true;
      return session.value;
    })();
    try {
      return await refreshInFlight.value;
    } finally {
      refreshInFlight.value = null;
    }
  }

  function requestOtp(mobile: string) {
    return $fetch<RequestCustomerOtpResult>('/customer-auth/otp', {
      method: 'POST',
      baseURL,
      credentials: 'include',
      headers: headers(),
      body: { mobile },
    });
  }

  async function verifyOtp(input: {
    challengeId: string;
    mobile: string;
    code: string;
    termsVersion: string;
    privacyVersion: string;
  }) {
    session.value = await $fetch<CustomerSession>('/customer-auth/verify', {
      method: 'POST',
      baseURL,
      credentials: 'include',
      headers: headers(),
      body: { ...input, consentAccepted: true },
    });
    loaded.value = true;
    return session.value;
  }

  async function logout(all = false) {
    if (session.value) {
      await $fetch(`/customer-auth/${all ? 'logout-all' : 'logout'}`, {
        method: 'POST',
        baseURL,
        credentials: 'include',
        headers: headers(true),
      });
    }
    session.value = null;
    loaded.value = true;
  }

  async function updateProfile(input: UpdateCustomerProfile) {
    session.value = await $fetch<CustomerSession>('/customer/profile', {
      method: 'PATCH',
      baseURL,
      credentials: 'include',
      headers: headers(true),
      body: input,
    });
    return session.value;
  }

  function registrations(cursor?: string, limit = 20) {
    return $fetch<CustomerRegistrationList>('/customer/registrations', {
      baseURL,
      credentials: 'include',
      headers: headers(),
      query: { ...(cursor ? { cursor } : {}), limit },
    });
  }

  function registration(registrationId: string) {
    return $fetch<CustomerRegistrationDetail>(
      `/customer/registrations/${encodeURIComponent(registrationId)}`,
      {
        baseURL,
        credentials: 'include',
        headers: headers(),
      },
    );
  }

  function claimRegistration(orderId: string, accessToken: string) {
    return $fetch<CustomerRegistrationDetail>('/customer/registration-claims', {
      method: 'POST',
      baseURL,
      credentials: 'include',
      headers: headers(true),
      body: { orderId, accessToken },
    });
  }

  function invoice(orderId: string) {
    return $fetch<CustomerInvoiceDetail>(
      `/customer/orders/${encodeURIComponent(orderId)}/invoice`,
      {
        baseURL,
        credentials: 'include',
        headers: headers(),
      },
    );
  }

  function invoiceContext(orderId: string) {
    return $fetch<CustomerInvoiceOrderContext>(
      `/customer/orders/${encodeURIComponent(orderId)}/invoice-context`,
      {
        baseURL,
        credentials: 'include',
        headers: headers(),
      },
    );
  }

  function invoices(category: CustomerInvoiceCenterCategory = 'all', cursor?: string, limit = 20) {
    return $fetch<CustomerInvoiceCenterList>('/customer/invoices', {
      baseURL,
      credentials: 'include',
      headers: headers(),
      query: { category, ...(cursor ? { cursor } : {}), limit },
    });
  }

  function submitInvoice(orderId: string, input: CustomerCreateInvoice | CustomerUpdateInvoice) {
    return $fetch<CustomerInvoiceDetail>(
      `/customer/orders/${encodeURIComponent(orderId)}/invoice`,
      {
        method: 'expectedUpdatedAt' in input ? 'PATCH' : 'POST',
        baseURL,
        credentials: 'include',
        headers: headers(true),
        body: input,
      },
    );
  }

  function sendInvoice(orderId: string) {
    return $fetch<CustomerInvoiceSendResult>(
      `/customer/orders/${encodeURIComponent(orderId)}/invoice/send`,
      {
        method: 'POST',
        baseURL,
        credentials: 'include',
        headers: headers(true),
      },
    );
  }

  function openLogin() {
    authDialogOpen.value = true;
  }

  return {
    session: readonly(session),
    loaded: readonly(loaded),
    authDialogOpen,
    refresh,
    requestOtp,
    verifyOtp,
    logout,
    updateProfile,
    registrations,
    registration,
    claimRegistration,
    invoices,
    invoice,
    invoiceContext,
    submitInvoice,
    sendInvoice,
    openLogin,
  };
}
