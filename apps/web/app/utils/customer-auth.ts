export function normalizeCustomerMobileInput(value: string) {
  const digits = value.replace(/\D/g, '');
  const mainlandDigits = digits.startsWith('86') && digits.length >= 13 ? digits.slice(2) : digits;
  return mainlandDigits.slice(0, 11);
}

export function maskCustomerMobile(value: string) {
  const digits = normalizeCustomerMobileInput(value);
  return digits.length === 11 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : digits;
}

export function customerOtpRetrySeconds(availableAt: number, now: number) {
  return Math.max(0, Math.ceil((availableAt - now) / 1_000));
}
