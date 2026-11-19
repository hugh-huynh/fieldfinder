import { describe, expect, it } from "vitest";

import { normaliseIp, verifyCrawler, type DnsResolver } from "./crawler";

// Crawler verification with a fake resolver (PR 4.3). Addresses are from documentation ranges or
// shaped like the published crawler ones; nothing here touches real DNS.

function resolver(ptr: Record<string, string[]>, forward: Record<string, string[]>): DnsResolver {
  const notFound = () => Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
  return {
    reverse: (ip) => (ip in ptr ? Promise.resolve(ptr[ip] ?? []) : notFound()),
    resolve: (hostname) => (hostname in forward ? Promise.resolve(forward[hostname] ?? []) : notFound()),
  };
}

describe("verifyCrawler", () => {
  it("verifies Googlebot when its name is in googlebot.com and resolves back", async () => {
    const dns = resolver(
      { "66.249.66.1": ["crawl-66-249-66-1.googlebot.com."] },
      { "crawl-66-249-66-1.googlebot.com": ["66.249.66.1"] },
    );
    expect(await verifyCrawler("66.249.66.1", dns)).toEqual({
      verified: true,
      crawler: "Googlebot",
      hostname: "crawl-66-249-66-1.googlebot.com",
    });
  });

  it("verifies Bingbot, and an IPv6 crawler written another way", async () => {
    const bing = resolver(
      { "157.55.39.1": ["msnbot-157-55-39-1.search.msn.com"] },
      { "msnbot-157-55-39-1.search.msn.com": ["157.55.39.1"] },
    );
    expect(await verifyCrawler("157.55.39.1", bing)).toMatchObject({ verified: true, crawler: "Bingbot" });

    const v6 = resolver(
      { "2001:4860:4801:10::1": ["crawl-2001-4860-4801-10--1.googlebot.com"] },
      { "crawl-2001-4860-4801-10--1.googlebot.com": ["2001:4860:4801:0010:0000:0000:0000:0001"] },
    );
    expect(await verifyCrawler("2001:4860:4801:10::1", v6)).toMatchObject({ verified: true });
  });

  it("refuses a name that only claims to be Google: lookalike domains and Google Cloud hosts", async () => {
    for (const hostname of [
      "crawl-1.googlebot.com.example.net",
      "evilgooglebot.com",
      "googlebot.example.com",
      "1.2.0.192.bc.googleusercontent.com",
    ]) {
      const dns = resolver({ "192.0.2.1": [hostname] }, { [hostname]: ["192.0.2.1"] });
      expect(await verifyCrawler("192.0.2.1", dns)).toEqual({
        verified: false,
        reason: "reverse DNS name isn't a search crawler's domain",
        hostname,
      });
    }
  });

  it("refuses a reverse name that's right but doesn't resolve back to the same IP", async () => {
    // Whoever controls 192.0.2.7's reverse zone can claim a googlebot.com name; only Google's forward
    // zone decides where that name points.
    const dns = resolver(
      { "192.0.2.7": ["crawl-66-249-66-1.googlebot.com"] },
      { "crawl-66-249-66-1.googlebot.com": ["66.249.66.1"] },
    );
    expect(await verifyCrawler("192.0.2.7", dns)).toMatchObject({
      verified: false,
      reason: "the name resolves to other addresses, not this one",
    });

    const gone = resolver({ "192.0.2.8": ["crawl-x.googlebot.com"] }, {});
    expect(await verifyCrawler("192.0.2.8", gone)).toMatchObject({
      verified: false,
      reason: "the name doesn't resolve back to an address",
    });
  });

  it("uses any PTR record that checks out both ways", async () => {
    const dns = resolver(
      { "66.249.66.2": ["mail.example.net", "crawl-66-249-66-2.googlebot.com"] },
      { "crawl-66-249-66-2.googlebot.com": ["66.249.66.2"] },
    );
    expect(await verifyCrawler("66.249.66.2", dns)).toMatchObject({ verified: true });
  });

  it("refuses an address with no reverse name, or no records at all, or not an IP", async () => {
    expect(await verifyCrawler("192.0.2.9", resolver({}, {}))).toEqual({
      verified: false,
      reason: "no reverse DNS name",
    });
    expect(await verifyCrawler("192.0.2.9", resolver({ "192.0.2.9": [] }, {}))).toEqual({
      verified: false,
      reason: "no reverse DNS name",
    });
    for (const input of ["", "googlebot", "66.249.66", "999.1.1.1"]) {
      expect(await verifyCrawler(input, resolver({}, {}))).toEqual({ verified: false, reason: "not an IP address" });
    }
  });
});

describe("normaliseIp", () => {
  it("gives every spelling of an address the same form", () => {
    expect(normaliseIp("2001:DB8::1")).toBe("2001:db8:0:0:0:0:0:1");
    expect(normaliseIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8:0:0:0:0:0:1");
    expect(normaliseIp("::ffff:192.0.2.1")).toBe("0:0:0:0:0:ffff:c000:201");
    expect(normaliseIp("192.0.2.1")).toBe("192.0.2.1");
    expect(normaliseIp("nope")).toBeNull();
  });
});
