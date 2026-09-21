export async function createCustomerSession({ apiBase, mobile, organizationSlug, forwardedFor }) {
  const organizationHeaders = {
    'Content-Type': 'application/json',
    'X-Organization-Slug': organizationSlug,
    ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
  };
  const challengeResponse = await fetch(`${apiBase}/customer-auth/otp`, {
    method: 'POST',
    headers: organizationHeaders,
    body: JSON.stringify({ mobile }),
  });
  const challenge = await challengeResponse.json().catch(() => ({}));
  if (!challengeResponse.ok) {
    throw new Error(
      `Customer OTP request failed: ${challengeResponse.status} ${JSON.stringify(challenge)}`,
    );
  }
  const developmentCode = challenge.developmentCode;
  if (typeof developmentCode !== 'string' || developmentCode.length !== 6) {
    throw new Error('Local customer OTP challenge did not expose a development code');
  }
  const verifyResponse = await fetch(`${apiBase}/customer-auth/verify`, {
    method: 'POST',
    headers: organizationHeaders,
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      mobile,
      code: developmentCode,
      consentAccepted: true,
      termsVersion: '',
      privacyVersion: '',
    }),
  });
  let session = await verifyResponse.json().catch(() => ({}));
  if (!verifyResponse.ok) {
    throw new Error(
      `Customer OTP verification failed: ${verifyResponse.status} ${JSON.stringify(session)}`,
    );
  }
  let cookie = verifyResponse.headers.get('set-cookie')?.split(';', 1)[0];
  if (session.consentRequired) {
    if (!cookie || !session.policy) {
      throw new Error('Customer OTP verification returned an incomplete consent challenge');
    }
    const consentResponse = await fetch(`${apiBase}/customer-auth/consent`, {
      method: 'POST',
      headers: {
        ...organizationHeaders,
        Cookie: cookie,
        Origin: process.env.PUBLIC_ORIGIN ?? new URL(apiBase).origin,
        'X-Consent-Confirmation': 'true',
      },
      body: JSON.stringify({
        consentAccepted: true,
        termsVersion: session.policy.termsVersion,
        privacyVersion: session.policy.privacyVersion,
      }),
    });
    session = await consentResponse.json().catch(() => ({}));
    if (!consentResponse.ok) {
      throw new Error(
        `Customer consent confirmation failed: ${consentResponse.status} ${JSON.stringify(session)}`,
      );
    }
    cookie = consentResponse.headers.get('set-cookie')?.split(';', 1)[0];
  }
  if (!cookie || typeof session.csrfToken !== 'string') {
    throw new Error('Customer OTP verification did not return a usable session');
  }
  return {
    cookie,
    csrfToken: session.csrfToken,
    customer: session.customer,
    headers: {
      Cookie: cookie,
      'X-Csrf-Token': session.csrfToken,
      'X-Organization-Slug': organizationSlug,
      ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
    },
  };
}
