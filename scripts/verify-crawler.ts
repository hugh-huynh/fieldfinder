// Checks whether IP addresses really are Googlebot or Bingbot (PR 4.3), by reverse then forward DNS
// (src/lib/rate-limit/crawler.ts). Run it before allowlisting a crawler IP or exempting it from a
// Vercel Firewall rule (docs/security/edge-rules.md):
//
//   pnpm crawler:verify 66.249.66.1 2001:4860:4801:10::1
//
// Exit code 0 only if every address is verified. Uses the machine's DNS; sends nothing else anywhere.

import { verifyCrawler } from "../src/lib/rate-limit/crawler.ts";

const ips = process.argv.slice(2);
if (ips.length === 0) {
  console.error("usage: pnpm crawler:verify <ip> [<ip> ...]");
  process.exit(2);
}

let allVerified = true;
for (const ip of ips) {
  const check = await verifyCrawler(ip);
  if (check.verified) {
    process.stdout.write(`${ip}  VERIFIED  ${check.crawler} (${check.hostname})\n`);
  } else {
    allVerified = false;
    process.stdout.write(
      `${ip}  NOT VERIFIED  ${check.reason}${check.hostname === undefined ? "" : ` (${check.hostname})`}\n`,
    );
  }
}
if (!allVerified) {
  console.error("\nDon't allowlist an address that isn't verified, whatever its User-Agent says.");
}
process.exit(allVerified ? 0 : 1);
