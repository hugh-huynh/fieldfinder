import "server-only";

// Where the site lives, for canonical URLs, the sitemap and robots.txt (PR 4.2). Not secret.
//
// - `SITE_URL` (e.g. https://fieldfinder.com.au) wins when set: the canonical origin once the domain
//   exists (4.6).
// - Otherwise Vercel's own production domain (`VERCEL_PROJECT_PRODUCTION_URL`, set automatically on
//   every Vercel deployment), so previews and staging point their canonicals at production.
// - Otherwise localhost (dev, tests).
//
// Search engines may index only the production deployment: everywhere else robots.txt disallows
// everything, so a preview or staging copy never competes with the real site.

export const SITE_URL_VAR = "SITE_URL";

const LOCAL_ORIGIN = "http://localhost:3000";

type Env = Record<string, string | undefined>;

function originOf(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  return url.origin;
}

/** The site's canonical origin, without a trailing slash. Throws (naming the variable) if SITE_URL is malformed. */
export function siteOrigin(source: Env = process.env): string {
  const configured = source[SITE_URL_VAR]?.trim();
  if (configured !== undefined && configured !== "") {
    const origin = originOf(configured);
    if (origin === null) throw new Error(`${SITE_URL_VAR} must be an https:// URL`);
    return origin;
  }
  const vercel = source.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel !== undefined && vercel !== "") {
    const origin = originOf(`https://${vercel}`);
    if (origin !== null) return origin;
  }
  return LOCAL_ORIGIN;
}

/** Absolute URL for a site path such as `/venues/x`. */
export function siteUrl(path: string, source: Env = process.env): string {
  return new URL(path, `${siteOrigin(source)}/`).toString();
}

/** Only Vercel's production deployment may be crawled. */
export function indexingAllowed(source: Env = process.env): boolean {
  return source.VERCEL_ENV === "production";
}
