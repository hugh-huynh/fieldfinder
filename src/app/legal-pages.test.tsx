import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LegalLinks, SiteFooter } from "@/components/SiteFooter";

import PrivacyPage, { metadata as privacyMetadata } from "./privacy/page";
import TermsPage, { metadata as termsMetadata } from "./terms/page";

// /privacy and /terms (PR 4.1): draft wording (plan P5) marked as such, the privacy page's analytics
// setting, and links to both from every page.

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST12345");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/privacy", () => {
  it("is titled, marked as a draft, and covers location, searching, analytics and providers", () => {
    render(<PrivacyPage />);
    expect(privacyMetadata.title).toBe("Privacy · FieldFinder");
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/Draft\./);
    for (const name of [
      "The short version",
      "Who we are",
      "Your location",
      "Searching for a place",
      "Analytics, only if you allow it",
      "Services that handle information for us",
      "What’s kept on your device",
      "Questions and complaints",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("says the exact location stays on the device and analytics is opt-in", () => {
    render(<PrivacyPage />);
    expect(within(screen.getByRole("region", { name: "The short version" })).getByRole("list")).toHaveTextContent(
      /exact location never leaves your device.*Analytics is off unless you allow it/s,
    );
  });

  it("lets the person change their analytics choice there", () => {
    render(<PrivacyPage />);
    const analytics = screen.getByRole("region", { name: "Analytics, only if you allow it" });
    expect(within(analytics).getByRole("group", { name: "Google Analytics in this browser" })).toBeInTheDocument();
  });

  it("names the regulator for complaints", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("link", { name: "Office of the Australian Information Commissioner" })).toHaveAttribute(
      "href",
      "https://www.oaic.gov.au/",
    );
  });
});

describe("/terms", () => {
  it("is titled, marked as a draft, and sets the data-reuse terms and credits", () => {
    render(<TermsPage />);
    expect(termsMetadata.title).toBe("Terms of use · FieldFinder");
    expect(screen.getByRole("note")).toHaveTextContent(/Draft\./);
    expect(screen.getByRole("region", { name: "Using the information" })).toHaveTextContent(/scraping/);
    expect(screen.getByRole("region", { name: "Content and credits" })).toHaveTextContent(
      "Maps © Mapbox © OpenStreetMap contributors.",
    );
    expect(screen.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy");
  });
});

describe("site links", () => {
  it("link to both pages, in a footer or inline", () => {
    const { unmount } = render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", "/terms");
    unmount();
    render(<LegalLinks />);
    expect(screen.getByRole("navigation", { name: "Site information" })).toBeInTheDocument();
  });
});
