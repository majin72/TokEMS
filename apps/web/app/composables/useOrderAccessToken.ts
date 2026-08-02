const STORAGE_PREFIX = 'conference.orderAccess.';

/**
 * Builds the sessionStorage key for an order access token.
 *
 * @param orderId - Order identifier
 * @returns Storage key scoped to the order
 */
export function orderAccessStorageKey(orderId: string): string {
  return `${STORAGE_PREFIX}${orderId}`;
}

/**
 * Reads a previously persisted order access token from sessionStorage.
 *
 * @param orderId - Order identifier
 * @returns Token string or empty string when missing / not on client
 */
export function readOrderAccessToken(orderId: string): string {
  if (!import.meta.client || !orderId) return '';
  try {
    return sessionStorage.getItem(orderAccessStorageKey(orderId)) ?? '';
  } catch {
    return '';
  }
}

/**
 * Persists an order access token in sessionStorage for the payment origin.
 * Tokens must never be written into the URL query string.
 *
 * @param orderId - Order identifier
 * @param token - Bearer order access token
 */
export function writeOrderAccessToken(orderId: string, token: string): void {
  if (!import.meta.client || !orderId || !token) return;
  try {
    sessionStorage.setItem(orderAccessStorageKey(orderId), token);
  } catch {
    // Private mode / quota failures should not break checkout.
  }
}

/**
 * Clears the persisted order access token for an order.
 *
 * @param orderId - Order identifier
 */
export function clearOrderAccessToken(orderId: string): void {
  if (!import.meta.client || !orderId) return;
  try {
    sessionStorage.removeItem(orderAccessStorageKey(orderId));
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Strips sensitive access material from the current URL without navigation.
 * Removes `#access=` / `#handoff=` fragments and any legacy `?access=` query.
 *
 * @param url - URL instance to mutate before replaceState
 * @param options - Which fragment keys to clear
 */
export function sanitizeOrderAccessUrl(
  url: URL,
  options: { clearAccessHash?: boolean; clearHandoffHash?: boolean } = {
    clearAccessHash: true,
    clearHandoffHash: false,
  },
): void {
  url.searchParams.delete('access');

  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    if (options.clearAccessHash) hashParams.delete('access');
    if (options.clearHandoffHash) hashParams.delete('handoff');
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : '';
  }
}

/**
 * Captures the order access token from `#access=` (preferred) or sessionStorage,
 * persists it, and cleans the URL so the token never remains in query or history.
 * Legacy `?access=` is stripped when present but is not treated as a valid source.
 *
 * @param orderId - Order identifier
 * @returns Resolved access token or empty string
 */
export function captureOrderAccessTokenFromUrl(orderId: string): string {
  if (!import.meta.client || !orderId) return '';

  const currentUrl = new URL(window.location.href);
  const hashParams = new URLSearchParams(currentUrl.hash.slice(1));
  const fragmentAccess = hashParams.get('access') ?? '';
  const hadQueryAccess = currentUrl.searchParams.has('access');
  const hadFragmentAccess = Boolean(fragmentAccess);

  if (fragmentAccess) {
    writeOrderAccessToken(orderId, fragmentAccess);
  }

  if (hadFragmentAccess || hadQueryAccess) {
    sanitizeOrderAccessUrl(currentUrl, { clearAccessHash: true, clearHandoffHash: false });
    const search = currentUrl.searchParams.toString();
    window.history.replaceState(
      {},
      '',
      `${currentUrl.pathname}${search ? `?${search}` : ''}${currentUrl.hash}`,
    );
  }

  return fragmentAccess || readOrderAccessToken(orderId);
}

/**
 * Reads an OAuth handoff code from the URL fragment and clears it via replaceState.
 *
 * @returns Handoff code or empty string
 */
export function captureOAuthHandoffFromUrl(): string {
  if (!import.meta.client) return '';

  const currentUrl = new URL(window.location.href);
  const hashParams = new URLSearchParams(currentUrl.hash.slice(1));
  const handoff = hashParams.get('handoff') ?? '';
  if (!handoff) return '';

  sanitizeOrderAccessUrl(currentUrl, { clearAccessHash: false, clearHandoffHash: true });
  const search = currentUrl.searchParams.toString();
  window.history.replaceState(
    {},
    '',
    `${currentUrl.pathname}${search ? `?${search}` : ''}${currentUrl.hash}`,
  );
  return handoff;
}

/**
 * Order access token helpers for payment pages.
 *
 * @returns Token capture / storage helpers
 */
export function useOrderAccessToken() {
  return {
    orderAccessStorageKey,
    readOrderAccessToken,
    writeOrderAccessToken,
    clearOrderAccessToken,
    captureOrderAccessTokenFromUrl,
    captureOAuthHandoffFromUrl,
    sanitizeOrderAccessUrl,
  };
}
