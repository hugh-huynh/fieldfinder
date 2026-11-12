import { describe, expect, it } from "vitest";

import { findSecrets, SECRET_PATTERNS } from "../../scripts/secret-patterns.ts";

// The client-bundle secret patterns (PR 2.15). Samples are assembled at runtime from obviously fake
// parts, so this file itself never contains anything shaped like a real credential (and gitleaks
// stays quiet about it).

const repeat = (char: string, n: number) => char.repeat(n);
const join = (...parts: string[]) => parts.join("");

const SAMPLES: Record<string, string> = {
  "FieldFinder admin token": join("ffadm", "_", repeat("A", 43)),
  "Anthropic API key or OAuth token": join("sk-", "ant-", "oat01-", repeat("x", 40)),
  "GitHub token": join("gh", "p_", repeat("a", 36)),
  "AWS access key id": join("AK", "IA", repeat("Z", 16)),
  "Mapbox secret token": join("sk.", "eyJ", repeat("a", 30), ".", repeat("b", 20)),
  "Stripe-style secret key": join("sk", "_live_", repeat("c", 24)),
  "private key block": join("-----BEGIN ", "RSA PRIVATE", " KEY-----"),
  "JSON Web Token": join("eyJ", repeat("h", 20), ".eyJ", repeat("p", 20), ".", repeat("s", 20)),
  "database URL with a password": join("postgres", "ql://", "user:", "pw-not-real", "@db.example:5432/x"),
};

describe("findSecrets", () => {
  it("has a sample for every pattern", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(SECRET_PATTERNS.map((p) => p.name).sort());
  });

  it.each(Object.entries(SAMPLES))("finds a %s inside minified code", (name, sample) => {
    expect(findSecrets(`var a="${sample}";function b(){}`)).toEqual([name]);
  });

  it.each([
    ["a public Mapbox token", join("pk.", "eyJ", repeat("a", 30), ".", repeat("b", 20))],
    ["a short ffadm_ mention", "ffadm_ prefix"],
    ["a database URL without a password", "postgres://localhost:5432/app"],
    ["a CSS class with sk-", "sk-ant-x"],
    ["an ordinary base64 string", "eyJhbGciOiJIUzI1NiJ9"],
    ["React's own vocabulary", "children props dangerouslySetInnerHTML __NEXT_DATA__"],
  ])("ignores %s", (_name, text) => {
    expect(findSecrets(text)).toEqual([]);
  });

  it("names what it found without echoing it", () => {
    const sample = SAMPLES["FieldFinder admin token"] ?? "";
    const found = findSecrets(sample).join(" ");
    expect(found).not.toContain(sample);
  });
});
