import "server-only";

import { isIP } from "node:net";

// Trusted client IP (spec §6, ADR-0004). Vercel overwrites `x-forwarded-for` with the address of the
// client that connected to it, so on Vercel that header is trustworthy. Anywhere else (local dev,
// tests, a self-hosted build) any client can set it, so no IP is trusted at all.
// Returns null when the IP is unknown; callers then share one "unknown" bucket.

export function clientIp(request: Request, env: Record<string, string | undefined> = process.env): string | null {
  if (env.VERCEL !== "1") return null;
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return isIP(first) === 0 ? null : first;
}

/**
 * The subject a client is rate-limited as. An IPv6 user usually controls a whole /64 and can rotate
 * addresses inside it freely, so IPv6 is counted per /64; IPv4 (including IPv4-mapped IPv6) per
 * address. Unknown IPs all share one subject.
 */
export function clientSubject(ip: string | null): string {
  if (ip === null) return "unknown";
  if (isIP(ip) === 4) return ip;
  const address = ip.split("%")[0] ?? ip; // drop any zone id
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped !== undefined) return mapped;

  // Expand "::" and keep the first four 16-bit groups. An embedded IPv4 tail counts as two groups.
  const [head = "", tail] = address.split("::");
  const groups = (part: string) =>
    part === "" ? [] : part.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g]));
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const full = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${full
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}
