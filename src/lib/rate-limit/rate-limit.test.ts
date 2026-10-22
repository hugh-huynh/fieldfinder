import { describe, expect, it } from "vitest";

import { clientIp, clientSubject } from "./client-ip";
import { createMemoryRateLimiter } from "./memory";
import { bucketKey, retryAfterSeconds, type RateLimitRule } from "./types";

const RULE: RateLimitRule = { name: "test.rule", limit: 3, windowSeconds: 60 };

describe("memory limiter (same semantics as admin_rate_limit_hit)", () => {
  it("allows up to the limit in a window, then blocks until the window ends", async () => {
    let now = new Date("2026-10-20T10:00:10Z");
    const limiter = createMemoryRateLimiter(() => now);

    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit(RULE, "a"));
    expect(results.map((r) => [r.allowed, r.hits])).toEqual([
      [true, 1],
      [true, 2],
      [true, 3],
      [false, 4],
    ]);
    expect(results[3]?.resetAt.toISOString()).toBe("2026-10-20T10:01:00.000Z");

    now = new Date("2026-10-20T10:01:00Z");
    expect(await limiter.hit(RULE, "a")).toMatchObject({ allowed: true, hits: 1 });
  });

  it("checks without counting at cost 0: blocked once the bucket is full", async () => {
    const limiter = createMemoryRateLimiter(() => new Date("2026-10-20T10:00:00Z"));
    expect(await limiter.hit(RULE, "a", 0)).toMatchObject({ allowed: true, hits: 0 });
    for (let i = 0; i < 3; i++) await limiter.hit(RULE, "a");
    expect(await limiter.hit(RULE, "a", 0)).toMatchObject({ allowed: false, hits: 3 });
    expect(await limiter.hit(RULE, "a", 0)).toMatchObject({ hits: 3 });
  });

  it("keeps subjects and rules apart", async () => {
    const limiter = createMemoryRateLimiter(() => new Date("2026-10-20T10:00:00Z"));
    for (let i = 0; i < 3; i++) await limiter.hit(RULE, "a");
    expect(await limiter.hit(RULE, "b")).toMatchObject({ allowed: true, hits: 1 });
    expect(await limiter.hit({ ...RULE, name: "other.rule" }, "a")).toMatchObject({ hits: 1 });
  });
});

describe("bucketKey", () => {
  it("hashes the subject, so no IP or id appears in the key", () => {
    const key = bucketKey(RULE, "203.0.113.7");
    expect(key).toMatch(/^test\.rule:[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.7");
    // Same format as the CHECK in migration 0005.
    expect(key).toMatch(/^[a-z0-9_.:-]{1,200}$/);
  });
});

describe("retryAfterSeconds", () => {
  it("rounds up and is at least 1", () => {
    const now = new Date("2026-10-20T10:00:00.000Z");
    expect(retryAfterSeconds(new Date("2026-10-20T10:00:29.200Z"), now)).toBe(30);
    expect(retryAfterSeconds(new Date("2026-10-20T10:00:00.000Z"), now)).toBe(1);
  });
});

describe("clientIp", () => {
  const request = (xff?: string) =>
    new Request("https://ff.test/", xff === undefined ? {} : { headers: { "x-forwarded-for": xff } });

  it("trusts x-forwarded-for only on Vercel", () => {
    expect(clientIp(request("203.0.113.7"), { VERCEL: "1" })).toBe("203.0.113.7");
    expect(clientIp(request("2001:db8::1"), { VERCEL: "1" })).toBe("2001:db8::1");
    expect(clientIp(request("203.0.113.7"), {})).toBeNull();
  });

  it("takes the first address and rejects anything that isn't an IP", () => {
    expect(clientIp(request("203.0.113.7, 10.0.0.1"), { VERCEL: "1" })).toBe("203.0.113.7");
    expect(clientIp(request("not-an-ip"), { VERCEL: "1" })).toBeNull();
    expect(clientIp(request(""), { VERCEL: "1" })).toBeNull();
    expect(clientIp(request(), { VERCEL: "1" })).toBeNull();
  });
});

describe("clientSubject", () => {
  it("counts IPv4 per address and unknown IPs as one client", () => {
    expect(clientSubject("203.0.113.7")).toBe("203.0.113.7");
    expect(clientSubject(null)).toBe("unknown");
  });

  it("counts IPv6 per /64, however the address is written", () => {
    const subject = "2001:db8:1:2::/64";
    for (const ip of [
      "2001:db8:1:2::1",
      "2001:db8:1:2:ffff:ffff:ffff:ffff",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:DB8:1:2::abcd",
      "2001:db8:1:2::1%eth0",
    ]) {
      expect(clientSubject(ip), ip).toBe(subject);
    }
    expect(clientSubject("2001:db8:1:3::1")).not.toBe(subject);
    expect(clientSubject("::1")).toBe("0:0:0:0::/64");
    expect(clientSubject("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(clientSubject("::2001:db8:1:2:3:4")).toBe("0:0:2001:db8::/64");
  });

  it("counts IPv4-mapped IPv6 as the IPv4 address", () => {
    expect(clientSubject("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
});
