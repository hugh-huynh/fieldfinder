import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { venueResult } from "../../../../tests/msw/venues";

import { VenueCard } from "./VenueCard";

// Venue card (PR 3.3): confirmed facts only, one link per venue, a placeholder when there's no photo.

const photo = {
  id: "5eed0000-0000-4000-8000-0000000000aa",
  url: "https://media.example/p/abc.webp",
  contentType: "image/webp" as const,
  width: 1200,
  height: 900,
  alt: "Two pitches beside the river path",
  displayOrder: 0,
  attribution: null,
};

describe("VenueCard", () => {
  it("shows the name as the card's one link, to the venue's destination", () => {
    render(<VenueCard venue={venueResult(1, { href: "/venues/test-venue-1/pitches/main" })} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Test Venue 1");
    expect(links[0]).toHaveAttribute("href", "/venues/test-venue-1/pitches/main");
    expect(screen.getByRole("heading", { level: 2, name: "Test Venue 1" })).toBeInTheDocument();
  });

  it("shows suburb, distance, pitch counts and confirmed pitch characteristics", () => {
    render(
      <VenueCard
        venue={venueResult(2, {
          distanceMeters: 2149,
          publishedPitchCount: 4,
          matchingPitchCount: 2,
          pitchSummary: { surfaces: ["grass", "synthetic"], formats: ["full"], floodlights: true },
        })}
      />,
    );
    expect(screen.getByText("Testville · 2.1 km")).toBeInTheDocument();
    const pitches = within(screen.getByRole("list", { name: "Pitches" }));
    expect(pitches.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "2 of 4 pitches match",
      "Grass + synthetic",
      "Full size",
      "Floodlights",
    ]);
  });

  it("lists only facilities confirmed as available; 'no' and unconfirmed never appear", () => {
    render(<VenueCard venue={venueResult(3, { amenities: { toilets: "yes", parking: "no", cafe: "yes" } })} />);
    const facilities = within(screen.getByRole("list", { name: "Facilities" }));
    expect(facilities.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Toilets", "Café"]);
    expect(screen.queryByText(/parking/i)).toBeNull();
    expect(screen.queryByText(/not confirmed/i)).toBeNull();
    expect(screen.queryByText(/\bno\b/i)).toBeNull();
  });

  it("omits the facilities list and characteristics when nothing is confirmed", () => {
    render(<VenueCard venue={venueResult(4, { publishedPitchCount: 1, matchingPitchCount: 1 })} />);
    expect(screen.queryByRole("list", { name: "Facilities" })).toBeNull();
    expect(within(screen.getByRole("list", { name: "Pitches" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("1 pitch")).toBeInTheDocument();
    expect(screen.queryByText(/floodlights/i)).toBeNull();
  });

  it("shows the photo with its alt text", () => {
    render(<VenueCard venue={venueResult(5, { image: photo })} />);
    expect(screen.getByRole("img", { name: photo.alt })).toHaveAttribute("src", photo.url);
    expect(screen.queryByTestId("image-placeholder")).toBeNull();
  });

  it("shows a decorative placeholder when there's no photo", () => {
    render(<VenueCard venue={venueResult(6)} />);
    expect(screen.getByTestId("image-placeholder")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("credits a photo whose licence needs attribution (ADR-0006)", () => {
    const attribution = {
      text: "J. Doe, CC BY 4.0",
      author: "J. Doe",
      sourceUrl: null,
      licenseName: "CC BY 4.0",
      licenseUrl: null,
    };
    render(<VenueCard venue={venueResult(7, { image: { ...photo, attribution } })} />);
    expect(screen.getByText("Photo: J. Doe, CC BY 4.0")).toBeInTheDocument();
  });

  it("falls back to the placeholder, without its credit, when the photo fails to load", () => {
    const attribution = {
      text: "J. Doe, CC BY 4.0",
      author: null,
      sourceUrl: null,
      licenseName: null,
      licenseUrl: null,
    };
    render(<VenueCard venue={venueResult(8, { image: { ...photo, attribution } })} />);
    fireEvent.error(screen.getByRole("img", { name: photo.alt }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("image-placeholder")).toBeInTheDocument();
    expect(screen.queryByText(/Photo:/)).toBeNull();
  });
});
