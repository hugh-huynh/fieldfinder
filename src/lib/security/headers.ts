// Baseline security headers applied to every route (see next.config.ts).
// CSP ships as Report-Only until the map and analytics origins are known (M3/M4), then switches to
// enforcing with per-request nonces.
//
// Images (PR 3.3): venue photos come from the public media bucket, so its origin (scheme + host from
// MEDIA_PUBLIC_BASE_URL, never the path) is allowed in img-src. A missing or malformed value adds
// nothing. Read here rather than via src/lib/env.ts, which is server-only and can't load in
// next.config.ts; the value isn't secret.

/** The http(s) origin of `value`, or null if it isn't a usable URL. */
export function mediaOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!/^https?:\/\//.test(trimmed) || !URL.canParse(trimmed)) return null;
  return new URL(trimmed).origin;
}

function contentSecurityPolicy(media: string | null): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' data: blob:", media].filter(Boolean).join(" "),
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export type SecurityHeader = { key: string; value: string };

export function buildSecurityHeaders(env: Record<string, string | undefined> = process.env): SecurityHeader[] {
  return [
    {
      key: "Content-Security-Policy-Report-Only",
      value: contentSecurityPolicy(mediaOrigin(env.MEDIA_PUBLIC_BASE_URL)),
    },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    },
  ];
}

/** The headers for this process's environment (next.config.ts reads them at build time). */
export const securityHeaders: SecurityHeader[] = buildSecurityHeaders();
