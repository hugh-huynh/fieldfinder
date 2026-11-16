import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { venueResult } from "../../../../tests/msw/venues";

import { MarkerPreview } from "./MarkerPreview";

// The marker preview's photo credit (ADR-0006): shown with a photo that needs one, never without.

const attribution = {
  text: "J. Doe, CC BY 4.0",
  author: "J. Doe",
  sourceUrl: null,
  licenseName: "CC BY 4.0",
  licenseUrl: null,
};

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

describe("MarkerPreview photo credit", () => {
  it("credits a photo whose licence needs attribution", () => {
    render(<MarkerPreview venue={venueResult(1, { image: { ...photo, attribution } })} onClose={vi.fn()} />);
    expect(screen.getByRole("img", { name: photo.alt })).toBeInTheDocument();
    expect(screen.getByText("Photo: J. Doe, CC BY 4.0")).toBeInTheDocument();
  });

  it("has no credit for a photo that doesn't need one, or when there's no photo", () => {
    const { unmount } = render(<MarkerPreview venue={venueResult(2, { image: photo })} onClose={vi.fn()} />);
    expect(screen.queryByText(/Photo:/)).toBeNull();
    unmount();
    render(<MarkerPreview venue={venueResult(3)} onClose={vi.fn()} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Photo:/)).toBeNull();
  });

  it("drops the credit with the photo when it fails to load", () => {
    render(<MarkerPreview venue={venueResult(4, { image: { ...photo, attribution } })} onClose={vi.fn()} />);
    fireEvent.error(screen.getByRole("img", { name: photo.alt }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Photo:/)).toBeNull();
  });
});
