import { ApiError } from "./errors";

// Optimistic concurrency for admin edits (PR 2.10). A record's version is its updated_at in whole
// microseconds since the epoch, computed by Postgres so no precision is lost in JavaScript. It's sent
// as a strong ETag; a PATCH must echo it in If-Match, and a stale one gets 409.

const ETAG = /^"(\d{1,20})"$/;

export function formatEtag(version: string): string {
  return `"${version}"`;
}

/** The version from If-Match. Missing or malformed → 400; comparing it is the caller's job. */
export function requireIfMatch(request: Request): string {
  const version = ETAG.exec(request.headers.get("if-match")?.trim() ?? "")?.[1];
  if (version === undefined) {
    throw new ApiError(
      "invalid_request",
      'Send the record\'s current ETag in If-Match, e.g. If-Match: "1761000000000000".',
    );
  }
  return version;
}
