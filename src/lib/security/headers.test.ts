import { describe, expect, it } from "vitest";
import { securityHeaders } from "./headers";

const header = (key: string) => securityHeaders.find((h) => h.key === key)?.value;

describe("securityHeaders", () => {
  it("forbids framing in both CSP and X-Frame-Options", () => {
    expect(header("Content-Security-Policy-Report-Only")).toContain("frame-ancestors 'none'");
    expect(header("X-Frame-Options")).toBe("DENY");
  });

  it("allows geolocation only for our own origin", () => {
    expect(header("Permissions-Policy")).toContain("geolocation=(self)");
  });

  it("does not leak full URLs (which may contain search coordinates) to other origins", () => {
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("blocks plugins and base-tag hijacking", () => {
    const csp = header("Content-Security-Policy-Report-Only");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});
