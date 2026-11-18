import { parseSearchState, serializeSearchState } from "@/features/search/state";

// What GA4 is told about the page (ADR-0005, spec §7, PR 4.1). The search URL holds the searched
// coordinates and the place as typed (which can be a street address), so neither may reach GA4:
// - `/` keeps only its filters, in their one canonical spelling (radius, surface, …);
// - every other page keeps its path only: detail pages have no query of their own, and anything
//   else in a query or fragment is unknown, so it's dropped.
// The origin is the page's own. A referrer from another site is cut to its origin; one from this
// site gets the same treatment as a page location.

export function sanitisePageLocation(href: string): string | null {
  if (!URL.canParse(href)) return null;
  const url = new URL(href);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.pathname !== "/") return `${url.origin}${url.pathname}`;
  const filters = parseSearchState(url.searchParams).filters;
  const query = serializeSearchState({ location: null, filters });
  return `${url.origin}/${query === "" ? "" : `?${query}`}`;
}

/** The referrer to report: this site's own pages sanitised like a page location, others as an origin. */
export function sanitiseReferrer(referrer: string, ownOrigin: string): string | null {
  if (referrer === "" || !URL.canParse(referrer)) return null;
  const url = new URL(referrer);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.origin === ownOrigin ? sanitisePageLocation(referrer) : url.origin;
}
