const FORWARDED_HEADERS = [
  'content-type',
  'content-security-policy',
  'cache-control',
  'etag',
  'referrer-policy',
  'permissions-policy',
  'content-language',
  'vary',
] as const;

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  if (url.pathname !== '/' || event.method !== 'GET') return;

  const config = useRuntimeConfig(event);
  const apiBase = String(config.apiInternalBase).replace(/\/$/u, '');
  const organizationSlug = String(config.public.organizationSlug);
  const eventSlug = String(config.public.eventSlug);

  let response: Response;
  try {
    response = await fetch(
      `${apiBase}/events/${encodeURIComponent(eventSlug)}/home-document`,
      {
        headers: {
          'X-Organization-Slug': organizationSlug,
          ...(getHeader(event, 'if-none-match')
            ? { 'If-None-Match': getHeader(event, 'if-none-match')! }
            : {}),
        },
        signal: AbortSignal.timeout(4_000),
      },
    );
  } catch {
    return;
  }

  if (response.status === 204) return;
  FORWARDED_HEADERS.forEach((header) => {
    const value = response.headers.get(header);
    if (value) setHeader(event, header, value);
  });
  setResponseStatus(event, response.status);
  if (response.status === 304) return '';
  return response.text();
});
