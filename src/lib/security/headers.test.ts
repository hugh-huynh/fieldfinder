import { describe, expect, it } from "vitest";
import { buildSecurityHeaders, mediaOrigin, securityHeaders } from "./headers";

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

  describe("images (PR 3.3)", () => {
    const imgSrc = (env: Record<string, string | undefined>) =>
      /img-src [^;]+/.exec(
        buildSecurityHeaders(env).find((h) => h.key === "Content-Security-Policy-Report-Only")?.value ?? "",
      )?.[0];

    it("allows the media bucket's origin only, not its path", () => {
      expect(imgSrc({ MEDIA_PUBLIC_BASE_URL: "https://abc.supabase.co/storage/v1/object/public/media-public/" })).toBe(
        "img-src 'self' data: blob: https://abc.supabase.co",
      );
    });

    it.each([undefined, "", "   ", "not a url", "javascript:alert(1)", "ftp://files.example", "https://"])(
      "adds nothing for %j",
      (value) => {
        expect(imgSrc({ MEDIA_PUBLIC_BASE_URL: value })).toBe("img-src 'self' data: blob:");
      },
    );

    it("keeps a local port", () => {
      expect(mediaOrigin("http://127.0.0.1:54321/storage/v1/object/public/media-public")).toBe(
        "http://127.0.0.1:54321",
      );
    });
  });
});
