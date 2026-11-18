import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PitchDetailResponse } from "@/features/venues/detail";

import PitchPage, { generateMetadata } from "./page";

// `/venues/[venueSlug]/pitches/[pitchSlug]` (PR 3.11) with the published-only lookup mocked; the
// database side is covered by tests/integration/venue-detail.test.ts and E2E. Synthetic data.

const lookup = vi.hoisted(() => ({ getPitchDetail: vi.fn() }));
vi.mock("@/features/venues/detail", () => lookup);
vi.mock("@/lib/db/public", () => ({ publicDb: () => ({}) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const photo = (id: string, alt: string) => ({
  id,
  url: `https://media.test/${id}.webp`,
  contentType: "image/webp" as const,
  width: 1600,
  height: 900,
  alt,
  displayOrder: 0,
  attribution: null,
});

function detail(pitch: Partial<PitchDetailResponse["pitch"]> = {}, publishedPitchCount = 3): PitchDetailResponse {
  return {
    pitch: {
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
      ...pitch,
    },
    venue: {
      id: "v1",
      slug: "test-reserve",
      name: "Test Reserve",
      streetAddress: null,
      suburb: "Testville",
      state: "VIC",
      postcode: "3054",
      location: { latitude: -37.784, longitude: 144.972 },
      description: null,
      access: "public",
      publishedPitchCount,
      amenities: { toilets: "yes" },
      updatedAt: "2026-11-01T00:00:00Z",
    },
    media: [photo("pitch-1", "The east pitch")],
    venueMedia: [photo("venue-1", "The pavilion"), photo("pitch-1", "The east pitch")],
  };
}

const params = (venueSlug: string, pitchSlug: string) => ({ params: Promise.resolve({ venueSlug, pitchSlug }) });
const specs = () => within(screen.getByRole("region", { name: "Pitch details" }));
const spec = (label: string) => specs().getByText(label).nextElementSibling?.textContent;

beforeEach(() => {
  lookup.getPitchDetail.mockReset();
});

describe("PitchPage", () => {
  it("shows the pitch's specs, its venue, the venue's facilities and directions", async () => {
    lookup.getPitchDetail.mockResolvedValue(detail());
    render(await PitchPage(params("test-reserve", "east-pitch")));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("East pitch");
    expect(screen.getByRole("link", { name: "Test Reserve" })).toHaveAttribute("href", "/venues/test-reserve");
    expect(spec("Surface")).toBe("Grass");
    expect(spec("Pitch size")).toBe("Full size");
    expect(spec("Dimensions")).toBe("100 × 64 m");
    expect(spec("Floodlights")).toBe("Yes");
    expect(spec("Access")).toBe("Public access (the venue's rule)");

    const facilities = screen.getByRole("region", { name: "Facilities at Test Reserve" });
    expect(facilities).toHaveTextContent("ToiletsYes");
    expect(facilities).toHaveTextContent("ParkingNot confirmed");

    const location = within(screen.getByRole("complementary", { name: "Location" }));
    expect(location.getByText("Testville VIC 3054")).toBeInTheDocument();
    expect(location.getByRole("link", { name: /Get directions/ })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=-37.784%2C144.972",
    );
    expect(location.getByRole("link", { name: "See all pitches" })).toHaveAttribute("href", "/venues/test-reserve");
    expect(lookup.getPitchDetail).toHaveBeenCalledWith(expect.anything(), "test-reserve", "east-pitch");
  });

  it("says 'Not confirmed' for every unknown spec", async () => {
    lookup.getPitchDetail.mockResolvedValue(
      detail({
        surface: null,
        pitchFormat: null,
        lengthMeters: null,
        widthMeters: null,
        floodlights: null,
        access: null,
        effectiveAccess: null,
      }),
    );
    render(await PitchPage(params("test-reserve", "east-pitch")));
    for (const label of ["Surface", "Pitch size", "Dimensions", "Floodlights", "Access"]) {
      expect(spec(label)).toBe("Not confirmed");
    }
    expect(specs().queryByText(/rule/)).toBeNull();
  });

  it("says when a pitch has its own access rule", async () => {
    lookup.getPitchDetail.mockResolvedValue(detail({ access: "members_only", effectiveAccess: "members_only" }));
    render(await PitchPage(params("test-reserve", "east-pitch")));
    expect(spec("Access")).toBe("Members only (this pitch's own rule)");
  });

  it("shows the pitch's photos first, then the venue's, never one twice", async () => {
    lookup.getPitchDetail.mockResolvedValue(detail());
    render(await PitchPage(params("test-reserve", "east-pitch")));
    expect(
      within(screen.getByRole("region", { name: "Photos of East pitch at Test Reserve" }))
        .getAllByRole("img")
        .map((img) => img.getAttribute("alt")),
    ).toEqual(["The east pitch", "The pavilion"]);
  });

  it("doesn't offer 'See all pitches' for a venue with only this one", async () => {
    lookup.getPitchDetail.mockResolvedValue(detail({}, 1));
    render(await PitchPage(params("test-reserve", "east-pitch")));
    expect(screen.queryByRole("link", { name: "See all pitches" })).toBeNull();
    // The venue page is still a link away.
    expect(screen.getByRole("link", { name: "Test Reserve" })).toBeInTheDocument();
  });

  it("is a 404 for anything not published, without saying why", async () => {
    lookup.getPitchDetail.mockResolvedValue(null);
    await expect(PitchPage(params("test-reserve", "draft-pitch"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["Bad Venue!", "east-pitch"],
    ["test-reserve", "Bad Pitch!"],
  ])("is a 404 for a malformed slug (%s / %s), without asking the database", async (venueSlug, pitchSlug) => {
    await expect(PitchPage(params(venueSlug, pitchSlug))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(lookup.getPitchDetail).not.toHaveBeenCalled();
  });

  it("titles the page after the pitch and venue, and gives nothing away for a missing one", async () => {
    lookup.getPitchDetail.mockResolvedValue(detail());
    expect((await generateMetadata(params("test-reserve", "east-pitch"))).title).toBe(
      "East pitch at Test Reserve, Testville · FieldFinder",
    );
    expect(await generateMetadata(params("test-reserve", "east-pitch"))).toMatchObject({
      alternates: { canonical: "/venues/test-reserve/pitches/east-pitch" },
      openGraph: { url: "/venues/test-reserve/pitches/east-pitch" },
    });
    lookup.getPitchDetail.mockResolvedValue(null);
    expect(await generateMetadata(params("test-reserve", "draft-pitch"))).toEqual({ title: "Not found · FieldFinder" });
  });

  it("shares the pitch's own photo first, and describes the pitch as structured data", async () => {
    lookup.getPitchDetail.mockResolvedValue({
      ...detail(),
      media: [photo("m-pitch", "The east pitch")],
      venueMedia: [photo("m-venue", "The pavilion")],
    });
    const metadata = await generateMetadata(params("test-reserve", "east-pitch"));
    expect(metadata.openGraph?.images).toEqual([
      { url: "https://media.test/m-pitch.webp", width: 1600, height: 900, alt: "The east pitch" },
    ]);

    const { container } = render(await PitchPage(params("test-reserve", "east-pitch")));
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0]?.textContent ?? "")).toMatchObject({
      "@type": "SportsActivityLocation",
      url: "http://localhost:3000/venues/test-reserve/pitches/east-pitch",
      image: ["https://media.test/m-pitch.webp", "https://media.test/m-venue.webp"],
      containedInPlace: { url: "http://localhost:3000/venues/test-reserve" },
    });
  });
});
