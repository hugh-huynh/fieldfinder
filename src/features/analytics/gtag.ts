import { parseEvent, type AnalyticsEvent } from "./events";
import { checkAnalyticsParams } from "./guard";

// The only code that talks to GA4 (PR 4.1). gtag.js is loaded only after consent (consent.ts), from
// this module rather than an inline script, so the CSP needs no inline allowance for it.
// - Page views are sent by hand (`send_page_view: false`): the App Router changes pages without a
//   load, so GA4's automatic page views would miss or double them.
// - `page_location` and `page_referrer` are always the sanitised ones (page-location.ts), set on the
//   config and on every hit, so gtag never falls back to the real URL, which holds coordinates.
// - Every hit passes the event schema and the forbidden-parameter guard, or isn't sent at all.
// - Google signals and ad personalisation are off; cookies last 13 months, not GA's default 2 years.

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const SCRIPT_ORIGIN = "https://www.googletagmanager.com";
/** About 13 months, in seconds. */
const COOKIE_EXPIRES_S = 34_164_000;

/** A GA4 web stream's measurement id, e.g. G-ABC123XYZ9. */
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,16}$/;

let active: { id: string; location: string; referrer: string | null } | null = null;

/** The configured measurement id, or null (no id, or not a GA4 one: analytics stays off). */
export function measurementId(value = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID): string | null {
  const trimmed = value?.trim() ?? "";
  return MEASUREMENT_ID.test(trimmed) ? trimmed : null;
}

function disableKey(id: string): string {
  return `ga-disable-${id}`;
}

function setDisabled(id: string, disabled: boolean) {
  // gtag.js's documented opt-out switch: while true, nothing is sent for this id.
  (window as unknown as Record<string, unknown>)[disableKey(id)] = disabled;
}

function installGtag(): Gtag {
  const layer = (window.dataLayer ??= []);
  window.gtag ??= function gtag() {
    // gtag.js reads only Arguments objects from the data layer, not arrays.
    // eslint-disable-next-line prefer-rest-params -- reason: gtag.js requires the Arguments object
    layer.push(arguments);
  } as Gtag;
  return window.gtag;
}

function send(gtag: Gtag, command: string, target: string, params: Record<string, unknown>): boolean {
  const checked = checkAnalyticsParams(params);
  if (!checked.ok) {
    // Never sent. The reason names the parameter, not its value.
    if (process.env.NODE_ENV !== "production") console.warn(`analytics: blocked ${target} (${checked.reason})`);
    return false;
  }
  gtag(command, target, params);
  return true;
}

function config(gtag: Gtag, id: string, location: string, referrer: string | null) {
  return send(gtag, "config", id, {
    send_page_view: false,
    page_location: location,
    ...(referrer === null ? {} : { page_referrer: referrer }),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: COOKIE_EXPIRES_S,
  });
}

/**
 * Starts GA4 for `id` (after consent) at the given sanitised location. Loads gtag.js once per page;
 * starting again after a stop just lifts the opt-out.
 */
export function startAnalytics(id: string, location: string, referrer: string | null): void {
  if (active?.id === id) return;
  const gtag = installGtag();
  setDisabled(id, false);
  if (!config(gtag, id, location, referrer)) return;
  active = { id, location, referrer };
  if (document.querySelector(`script[data-ff-gtag="${id}"]`) === null) {
    gtag("js", new Date());
    const script = document.createElement("script");
    script.async = true;
    script.src = `${SCRIPT_ORIGIN}/gtag/js?id=${encodeURIComponent(id)}`;
    script.dataset.ffGtag = id;
    document.head.append(script);
  }
}

/** Every cookie name GA4 sets (`_ga`, `_ga_<stream>`). */
function analyticsCookieNames(): string[] {
  return document.cookie
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
}

/** Stops sending (consent withdrawn) and removes GA4's cookies from this site and its parent domains. */
export function stopAnalytics(id: string): void {
  setDisabled(id, true);
  active = null;
  const labels = window.location.hostname.split(".");
  const domains = labels.map((_, index) => labels.slice(index).join(".")).filter((d) => d.includes("."));
  for (const name of analyticsCookieNames()) {
    const expired = `${name}=; Max-Age=0; Path=/`;
    document.cookie = expired;
    for (const domain of domains) document.cookie = `${expired}; Domain=.${domain}`;
  }
}

export function analyticsActive(): boolean {
  return active !== null;
}

/** One page view for a navigation, at its sanitised location, with the page it came from. */
export function sendPageView(location: string, title: string): boolean {
  if (active === null) return false;
  const gtag = installGtag();
  // The page before this one in the app (or the sanitised document.referrer on the first view).
  const referrer = active.location === location ? active.referrer : active.location;
  active = { ...active, location, referrer };
  // Later events in this page carry these too, never the real URL.
  config(gtag, active.id, location, referrer);
  return send(gtag, "event", "page_view", {
    page_location: location,
    ...(referrer === null ? {} : { page_referrer: referrer }),
    page_title: title,
  });
}

/** Sends one event if analytics is on and the event is exactly as its schema says; otherwise nothing. */
export function track(event: AnalyticsEvent): boolean {
  if (active === null) return false;
  const parsed = parseEvent(event.name, event.params);
  if (parsed === null) {
    if (process.env.NODE_ENV !== "production") console.warn(`analytics: blocked ${event.name} (schema)`);
    return false;
  }
  return send(installGtag(), "event", parsed.name, { ...parsed.params, page_location: active.location });
}

/** For tests: forget the running state (gtag.js itself is never really loaded in tests). */
export function resetAnalyticsForTests(): void {
  active = null;
}
