// The forbidden-parameter guard (spec §7, ADR-0005, PR 4.1): the last check before anything is handed
// to gtag. The event schemas (events.ts) already allow only known parameters; this is independent of
// them, so a schema mistake still can't send a coordinate, an email, a token or a typed address.
// It looks at key names and at values, recursively, and rejects the whole event on any match.

/** Key names that may hold a location, a person's details or a credential, however they're spelled. */
const FORBIDDEN_KEY =
  /(^|_)(lat|lng|lon|long|latitude|longitude|coords?|coordinates|geo|position|address|street|postcode|place|query|q|email|e_?mail|phone|name|first_?name|last_?name|user|username|token|access_?token|id_?token|secret|password|passwd|auth|authorization|cookie|session|ip|ip_?address|key|api_?key)($|_)/i;

/**
 * Names that contain a forbidden word but are known to be safe: public, non-personal venue and pitch
 * ids (§7), and gtag's cookie lifetime setting (a number of seconds). Their values are still checked.
 */
const SAFE_KEYS = new Set(["venue_id", "pitch_id", "cookie_expires"]);

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** Anything that looks like a latitude/longitude, alone or as a pair: 3+ decimals, Australian range or not. */
const COORDINATE_LIKE = /-?\d{1,3}\.\d{3,}/;
/** A query string or fragment carrying coordinates, e.g. a URL with "lat=". */
const COORDINATE_PARAM = /(^|[?&#;])(lat|lng|lon|latitude|longitude)=/i;
/** A JWT, a Bearer credential, or a Mapbox token. */
const TOKEN_LIKE = /(eyJ[\w-]{8,}\.[\w-]{8,})|(\bbearer\s+\S+)|(\b(pk|sk|tk)\.[\w-]{10,})/i;

export type GuardResult = { ok: true } | { ok: false; reason: string };

function checkValue(path: string, value: unknown, depth: number): GuardResult {
  if (depth > 4) return { ok: false, reason: `${path}: nested too deeply` };
  if (value === null || value === undefined || typeof value === "boolean") return { ok: true };
  if (typeof value === "number") {
    // Ids and counts are integers; a fractional number with this much precision is a coordinate.
    return Number.isFinite(value) && !COORDINATE_LIKE.test(String(value))
      ? { ok: true }
      : { ok: false, reason: `${path}: looks like a coordinate` };
  }
  if (typeof value === "string") {
    if (EMAIL.test(value)) return { ok: false, reason: `${path}: looks like an email address` };
    if (TOKEN_LIKE.test(value)) return { ok: false, reason: `${path}: looks like a credential` };
    if (COORDINATE_PARAM.test(value) || COORDINATE_LIKE.test(value)) {
      return { ok: false, reason: `${path}: looks like a coordinate` };
    }
    return { ok: true };
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = checkValue(`${path}[${String(index)}]`, item, depth + 1);
      if (!result.ok) return result;
    }
    return { ok: true };
  }
  if (typeof value === "object") return checkParams(value as Record<string, unknown>, path, depth + 1);
  return { ok: false, reason: `${path}: unsupported value` };
}

function checkParams(params: Record<string, unknown>, prefix: string, depth: number): GuardResult {
  for (const [key, value] of Object.entries(params)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (!SAFE_KEYS.has(key) && FORBIDDEN_KEY.test(key)) {
      return { ok: false, reason: `${path}: forbidden parameter name` };
    }
    const result = checkValue(path, value, depth);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** Whether `params` is safe to send to GA4. The reason names the parameter, never its value. */
export function checkAnalyticsParams(params: Record<string, unknown>): GuardResult {
  return checkParams(params, "", 0);
}
