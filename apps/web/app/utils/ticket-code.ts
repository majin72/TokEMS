const TICKET_CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function createLocalTicketCode() {
  const values = crypto.getRandomValues(new Uint8Array(10));
  const suffix = Array.from(values, (value) => TICKET_CODE_ALPHABET[value % 36]).join('');
  return `TOK-T-${suffix}`;
}

export function createLocalTicketIdentity(eventId: string | number) {
  const code = createLocalTicketCode();
  return { code, qrPayload: `conference:${eventId}:${code}` };
}
