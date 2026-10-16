/**
 * New id for one API request, returned in `x-request-id` and every error body. Always generated
 * here: client-supplied ids are ignored so they can't forge or inject log entries.
 */
export function newRequestId(): string {
  return crypto.randomUUID();
}
