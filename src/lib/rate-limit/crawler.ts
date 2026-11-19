import { promises as dns } from "node:dns";
import { isIP } from "node:net";

// Search-crawler verification (spec §6, PR 4.3): before any crawler IP is allowlisted or exempted
// from a limit, prove it belongs to the search engine. A User-Agent says nothing (anyone can send
// "Googlebot"), so it's never the test. The check is the one Google and Bing document:
//
//   1. reverse DNS: the IP's hostname must be in the crawler's own domain;
//   2. forward DNS: that hostname must resolve back to the same IP.
//
// Step 2 matters because whoever controls an IP's reverse zone can make it claim any hostname; only
// the search engine controls the forward zone. Run it with `pnpm crawler:verify <ip>`
// (scripts/verify-crawler.ts); docs/security/edge-rules.md says when.
//
// No `server-only` or `@/` imports: Node runs the script straight from TypeScript.

export interface CrawlerDomain {
  name: string;
  /** Hostname suffixes, each starting with a dot so `evilgooglebot.com` can't match. */
  suffixes: readonly string[];
}

/**
 * Domains whose hosts are the search engines' own crawlers. Google also lists
 * `googleusercontent.com`, but that's where any Google Cloud customer's VM resolves, and the
 * fetchers there act for users, not for Search: never enough to allowlist.
 */
export const SEARCH_CRAWLERS: readonly CrawlerDomain[] = [
  // crawl-*.googlebot.com, geo-crawl-*.geo.googlebot.com; special crawlers rate-limited-proxy-*.google.com
  { name: "Googlebot", suffixes: [".googlebot.com", ".google.com"] },
  // msnbot-*.search.msn.com
  { name: "Bingbot", suffixes: [".search.msn.com"] },
];

export interface DnsResolver {
  reverse(ip: string): Promise<string[]>;
  /** A records for family 4, AAAA for family 6. */
  resolve(hostname: string, family: 4 | 6): Promise<string[]>;
}

export type CrawlerCheck =
  { verified: true; crawler: string; hostname: string } | { verified: false; reason: string; hostname?: string };

/** The system resolver, with each lookup capped so a slow DNS server can't hang the check. */
export function systemResolver(timeoutMs = 5_000): DnsResolver {
  const resolver = new dns.Resolver({ timeout: timeoutMs, tries: 2 });
  return {
    reverse: (ip) => resolver.reverse(ip),
    resolve: (hostname, family) => (family === 4 ? resolver.resolve4(hostname) : resolver.resolve6(hostname)),
  };
}

/** One spelling per address: IPv4 as is, IPv6 as eight lower-case groups without leading zeros. */
export function normaliseIp(ip: string): string | null {
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;
  const address = (ip.split("%")[0] ?? ip).toLowerCase();
  const [head = "", tail] = address.split("::");
  const groups = (part: string) => {
    if (part === "") return [];
    return part.split(":").flatMap((group) => {
      if (!group.includes(".")) return [group];
      const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
      return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
    });
  };
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const full = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return full.map((group) => parseInt(group, 16).toString(16)).join(":");
}

function crawlerFor(hostname: string): CrawlerDomain | undefined {
  return SEARCH_CRAWLERS.find((crawler) => crawler.suffixes.some((suffix) => hostname.endsWith(suffix)));
}

/** Whether `ip` is a search engine's crawler, by reverse then forward DNS. Never throws. */
export async function verifyCrawler(ip: string, resolver: DnsResolver = systemResolver()): Promise<CrawlerCheck> {
  const address = normaliseIp(ip.trim());
  if (address === null) return { verified: false, reason: "not an IP address" };
  const family = isIP(ip.trim()) as 4 | 6;

  let names: string[];
  try {
    names = await resolver.reverse(ip.trim());
  } catch {
    return { verified: false, reason: "no reverse DNS name" };
  }

  // An IP can have several PTR records; any one that checks out in both directions is enough.
  let rejected: { reason: string; hostname: string } | null = null;
  for (const raw of names) {
    const hostname = raw.toLowerCase().replace(/\.$/, "");
    const crawler = crawlerFor(hostname);
    if (crawler === undefined) {
      rejected ??= { reason: "reverse DNS name isn't a search crawler's domain", hostname };
      continue;
    }
    let forward: string[];
    try {
      forward = await resolver.resolve(hostname, family);
    } catch {
      rejected = { reason: "the name doesn't resolve back to an address", hostname };
      continue;
    }
    if (forward.some((candidate) => normaliseIp(candidate) === address)) {
      return { verified: true, crawler: crawler.name, hostname };
    }
    rejected = { reason: "the name resolves to other addresses, not this one", hostname };
  }
  return rejected === null ? { verified: false, reason: "no reverse DNS name" } : { verified: false, ...rejected };
}
