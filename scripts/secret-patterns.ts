// Shapes of credentials that must never ship to a browser (PR 2.15). Used by
// scripts/check-client-bundle.ts on everything under .next/static, on top of its checks for our own
// server-only variable names and values. Each pattern matches a credential's format, not a specific
// value, so it also catches secrets this repo doesn't know about (e.g. one pasted into client code).

export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: "FieldFinder admin token", pattern: /ffadm_[A-Za-z0-9_-]{43}/ },
  { name: "Anthropic API key or OAuth token", pattern: /sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { name: "AWS access key id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "Mapbox secret token", pattern: /\bsk\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Stripe-style secret key", pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}/ },
  { name: "private key block", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  // Supabase service-role and anon keys are JWTs; no JWT belongs in this app's client bundle.
  { name: "JSON Web Token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "database URL with a password", pattern: /\bpostgres(?:ql)?:\/\/[^\s:/@"'`]+:[^\s@/"'`]+@/ },
];

/** Names of the patterns found in `text`. Never returns the matched text itself. */
export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}
