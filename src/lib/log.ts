// Structured JSON logger with redaction (spec §7, ADR-0005, CLAUDE.md rule 3).
// Exact coordinates, credentials and tokens must never reach logs, so values are scrubbed here
// rather than trusting every call site.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogSink = (level: LogLevel, line: string) => void;

export const REDACTED = "[redacted]";

// Keys whose values are always dropped, wherever they appear in the object tree.
const SENSITIVE_KEY =
  /^(lat|lng|lon|latitude|longitude|coords?|coordinates|position|geo|location|authorization|proxy-authorization|cookie|set-cookie|dsn|ip|ip_?address|x-forwarded-for|x-real-ip)$/i;
const SENSITIVE_KEY_PART =
  /token|secret|passw(or)?d|api[-_]?key|credential|database[-_]?url|connection[-_]?string|private[-_]?key/i;

// Patterns scrubbed out of any string value (messages, URLs, stacks).
const STRING_SCRUBBERS: readonly [RegExp, string][] = [
  // Query parameters carrying location or secrets: ?lat=-37.81&token=abc
  [
    /([?&;](?:lat|lng|lon|latitude|longitude|token|access_token|key|api_key|apikey|secret|password)=)[^&#\s"']*/gi,
    `$1${REDACTED}`,
  ],
  // Authorization header values
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  // Credentials inside connection strings: postgres://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s]+@/gi, `$1${REDACTED}@`],
  // Coordinate pairs in free text: "-37.8136, 144.9631"
  [/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, REDACTED],
];

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 2_000;

export function scrubString(value: string): string {
  let out = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  for (const [pattern, replacement] of STRING_SCRUBBERS) out = out.replace(pattern, replacement);
  return out;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || SENSITIVE_KEY_PART.test(key);
}

/**
 * Errors keep only name, message, SQLSTATE code and stack. Postgres errors also carry `detail`
 * (the failing row), `query` and `parameters` (user input); none of those are ever logged.
 */
function serializeError(error: Error, seen: WeakSet<object>, depth: number): Record<string, unknown> {
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    message: scrubString(error.message),
    ...(typeof code === "string" ? { code } : {}),
    ...(error.stack ? { stack: scrubString(error.stack) } : {}),
    ...(error.cause instanceof Error && depth < MAX_DEPTH
      ? { cause: serializeError(error.cause, seen, depth + 1) }
      : {}),
  };
}

/** Deep copy of `value` with sensitive keys and patterns removed. Safe on cycles. */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";
  seen.add(value);

  if (value instanceof Error) return serializeError(value, seen, depth);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return scrubString(value.toString());
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => redact(item, seen, depth + 1));
    return value.length > MAX_ARRAY ? [...items, `[+${String(value.length - MAX_ARRAY)} more]`] : items;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(child, seen, depth + 1);
  }
  return out;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const consoleSink: LogSink = (level, line) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  // eslint-disable-next-line no-console -- reason: the logger is the one sanctioned stdout sink.
  else console.log(line);
};

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function createLogger(sink: LogSink = consoleSink, minLevel: LogLevel = "info"): Logger {
  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
    // Caller fields can't overwrite the envelope.
    const line = { ...(redact(fields) as Record<string, unknown>), ts: new Date().toISOString(), level, event };
    sink(level, JSON.stringify(line));
  };
  return {
    debug: (event, fields) => {
      write("debug", event, fields);
    },
    info: (event, fields) => {
      write("info", event, fields);
    },
    warn: (event, fields) => {
      write("warn", event, fields);
    },
    error: (event, fields) => {
      write("error", event, fields);
    },
  };
}

export const log: Logger = createLogger(consoleSink, process.env.LOG_LEVEL === "debug" ? "debug" : "info");
