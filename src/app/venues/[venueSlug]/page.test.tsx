import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VenueDetailResponse } from "@/features/venues/detail";

import VenuePage, { generateMetadata } from "./page";

// `/venues/[venueSlug]` (PR 3.10) with the published-only lookup mocked; the database side is
// covered by tests/integration/venue-detail.test.ts and the E2E deep-link test. Synthetic data.

const lookup = vi.hoisted(() => ({ getVenueDetail: vi.fn() }));
vi.mock("@/features/venues/detail", () => lookup);
vi.mock("@/lib/db/public", () => ({ publicDb: () => ({}) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

function detail(overrides: Partial<VenueDetailResponse["venue"]> = {}, media: VenueDetailResponse["media"] = []) {
  return {
    venue: {
      id: "v1",
      slug: "test-reserve",
      name: "Test Reserve",
      streetAddress: "1 Example Parade",
      suburb: "Testville",
      state: "VIC",
      postcode: "3054",
      location: { latitude: -37.784, longitude: 144.972 },
      description: "A synthetic venue.",
      access: "public",
      publishedPitchCount: 2,
      amenities: { toilets: "yes", cafe: "no" },
      updatedAt: "2026-11-01T00:00:00Z",
      ...overrides,
    },
    pitches: [
      {
        id: "p1",
        venueId: "v1",
        venueSlug: "test-reserve",
        slug: "east-pitch",
        name: "East pitch",
        surface: "grass",
        pitchFormat: "full",
        lengthMeters: 100,
        widthMeters: 64,
        floodlights: true,
        access: null,
        effectiveAccess: "public",
        updatedAt: "2026-11-01T00:00:00Z",
      },
      {
        id: "p2",
        venueId: "v1",
        venueSlug: "test-reserve",
        slug: "west-pitch",
        name: "West pitch",
        surface: null,
        pitchFormat: null,
        lengthMeters: null,
        widthMeters: null,
        floodlights: null,
        access: null,
        effectiveAccess: null,
        updatedAt: "2026-11-01T00:00:00Z",
      },
    ],
    media,
  } satisfies VenueDetailResponse;
}

const params = (venueSlug: string) => ({ params: Promise.resolve({ venueSlug }) });

beforeEach(() => {
  lookup.getVenueDetail.mockReset();
});

describe("VenuePage", () => {
  it("shows the venue, its pitches linking to their pages, facilities and directions", async () => {
    lookup.getVenueDetail.mockResolvedValue(detail());
    render(await VenuePage(params("test-reserve")));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Test Reserve");
    const pitches = within(screen.getByRole("region", { name: "Pitches" }));
    expect(pitches.getByRole("link", { name: "East pitch" })).toHaveAttribute(
      "href",
      "/venues/test-reserve/pitches/east-pitch",
    );
    expect(pitches.getByRole("link", { name: "West pitch" })).toHaveAttribute(
      "href",
      "/venues/test-reserve/pitches/west-pitch",
    );
    // Confirmed facts only on a card: the West pitch has none, so no facts list.
    expect(pitches.getAllByRole("list", { name: "Pitch details" })).toHaveLength(1);
    expect(pitches.getByText("100 × 64 m")).toBeInTheDocument();

    const facilities = screen.getByRole("region", { name: "Facilities" });
    expect(facilities).toHaveTextContent("ToiletsYes");
    expect(facilities).toHaveTextContent("CaféNo");
    expect(facilities).toHaveTextContent("ParkingNot confirmed");

    const location = within(screen.getByRole("complementary", { name: "Location" }));
    expect(location.getByText("1 Example Parade, Testville VIC 3054")).toBeInTheDocument();
    const directions = location.getByRole("link", { name: /Get directions/ });
    expect(directions).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&destination=-37.784%2C144.972");
    expect(directions).toHaveAttribute("target", "_blank");
    expect(directions).toHaveAttribute("rel", "noopener noreferrer");
    expect(lookup.getVenueDetail).toHaveBeenCalledWith(expect.anything(), "test-reserve");
  });

  it("says 'Not confirmed' for unknown access and leaves out a missing address line and description", async () => {
    lookup.getVenueDetail.mockResolvedValue(
      detail({ access: null, streetAddress: null, postcode: null, description: null }),
    );
    render(await VenuePage(params("test-reserve")));
    expect(screen.getByRole("complementary", { name: "Location" })).toHaveTextContent("AccessNot confirmed");
    expect(screen.getByText("Testville VIC")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "About" })).toBeNull();
  });

  it("shows photos with their credits, or a placeholder when there are none", async () => {
    lookup.getVenueDetail.mockResolvedValue(
      detail({}, [
        {
          id: "m1",
          url: "https://media.test/one.webp",
          contentType: "image/webp",
          width: 1600,
          height: 900,
          alt: "The east pitch at dusk",
          displayOrder: 0,
          attribution: {
            text: "A. Photographer, CC BY 4.0",
            author: "A. Photographer",
            sourceUrl: null,
            licenseName: "CC BY 4.0",
            licenseUrl: null,
          },
        },
      ]),
    );
    const { unmount } = render(await VenuePage(params("test-reserve")));
    expect(screen.getByRole("img", { name: "The east pitch at dusk" })).toBeInTheDocument();
    expect(screen.getByText("Photo: A. Photographer, CC BY 4.0")).toBeInTheDocument();
    unmount();

    lookup.getVenueDetail.mockResolvedValue(detail());
    render(await VenuePage(params("test-reserve")));
    expect(screen.getByTestId("gallery-placeholder")).toHaveTextContent("No photos of Test Reserve yet");
  });

  it("is a 404 for anything not published, without saying why", async () => {
    lookup.getVenueDetail.mockResolvedValue(null);
    await expect(VenuePage(params("hidden-draft-park"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is a 404 for a malformed slug, without asking the database", async () => {
    await expect(VenuePage(params("Not A Slug!"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(lookup.getVenueDetail).not.toHaveBeenCalled();
  });

  it("titles the page after the venue with its canonical URL, and gives nothing away for a missing one", async () => {
    lookup.getVenueDetail.mockResolvedValue(detail());
    const metadata = await generateMetadata(params("test-reserve"));
    expect(metadata).toMatchObject({
      title: "Test Reserve, Testville · FieldFinder",
      description: "Test Reserve in Testville VIC: 2 pitches, facilities and directions.",
      alternates: { canonical: "/venues/test-reserve" },
      openGraph: { url: "/venues/test-reserve", siteName: "FieldFinder", locale: "en_AU" },
    });
    // No photos, no share image.
    expect(metadata.openGraph).not.toHaveProperty("images");

    lookup.getVenueDetail.mockResolvedValue(null);
    expect(await generateMetadata(params("hidden-draft-park"))).toEqual({ title: "Not found · FieldFinder" });
  });

  it("describes the venue as structured data, from what the page shows", async () => {
    lookup.getVenueDetail.mockResolvedValue(detail());
    const { container } = render(await VenuePage(params("test-reserve")));
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);
    const data = JSON.parse(scripts[0]?.textContent ?? "") as Record<string, unknown>;
    expect(data).toMatchObject({
      "@type": "SportsActivityLocation",
      name: "Test Reserve",
      url: "http://localhost:3000/venues/test-reserve",
      containsPlace: [
        { name: "East pitch", url: "http://localhost:3000/venues/test-reserve/pitches/east-pitch" },
        { name: "West pitch", url: "http://localhost:3000/venues/test-reserve/pitches/west-pitch" },
      ],
    });
  });
});
