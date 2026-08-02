const TICKET_CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TICKET_CODE_SUFFIX_LENGTH = 16;

/**
 * Creates a local/demo ticket code with the same entropy contract as the API.
 *
 * @returns Ticket code in the form `TOK-T-` + 16 uppercase alphanumeric characters
 */
export function createLocalTicketCode() {
  const values = crypto.getRandomValues(new Uint8Array(TICKET_CODE_SUFFIX_LENGTH));
  const suffix = Array.from(
    values,
    (value) => TICKET_CODE_ALPHABET[value % TICKET_CODE_ALPHABET.length],
  ).join('');
  return `TOK-T-${suffix}`;
}

/**
 * Builds a local ticket identity used by offline/demo flows.
 *
 * @param eventId - Event identifier embedded in the QR payload
 * @returns Ticket code and QR payload pair
 */
export function createLocalTicketIdentity(eventId: string | number) {
  const code = createLocalTicketCode();
  return { code, qrPayload: `conference:${eventId}:${code}` };
}
