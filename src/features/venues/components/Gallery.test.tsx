import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { MediaDto } from "../dto";

import { Gallery } from "./Gallery";

// The detail pages' gallery and lightbox (PR 3.12). jsdom has no real modal behaviour
// (tests/setup/dom.ts stands in); E2E covers focus trapping and layout shift.

const photo = (n: number, attribution: MediaDto["attribution"] = null): MediaDto => ({
  id: `m${String(n)}`,
  url: `https://media.test/${String(n)}.webp`,
  contentType: "image/webp",
  width: 1600,
  height: 900,
  alt: `Photo ${String(n)} description`,
  displayOrder: n,
  attribution,
});

const credit = {
  text: "A. Photographer, CC BY 4.0",
  author: "A. Photographer",
  sourceUrl: null,
  licenseName: "CC BY 4.0",
  licenseUrl: null,
};

const lightbox = () => document.querySelector("dialog");
const caption = () => within(lightbox() as HTMLElement).getByText(/^Photo \d of \d$/).textContent;

describe("Gallery", () => {
  it("shows a placeholder when there are no photos", () => {
    render(<Gallery media={[]} label="Test Reserve" />);
    expect(screen.getByTestId("gallery-placeholder")).toHaveTextContent("No photos of Test Reserve yet");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("makes every photo a button that names it, with credits where needed", () => {
    render(<Gallery media={[photo(1), photo(2, credit), photo(3)]} label="Test Reserve" />);
    const region = within(screen.getByRole("region", { name: "Photos of Test Reserve" }));
    expect(region.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open photo 1 of 3: Photo 1 description",
      "Open photo 2 of 3: Photo 2 description",
      "Open photo 3 of 3: Photo 3 description",
    ]);
    expect(region.getByText("Photo: A. Photographer, CC BY 4.0")).toBeInTheDocument();
  });

  it("opens the lightbox at the photo pressed, and moves with the buttons and arrow keys, wrapping", async () => {
    const user = userEvent.setup();
    render(<Gallery media={[photo(1), photo(2, credit), photo(3)]} label="Test Reserve" />);
    await user.click(screen.getByRole("button", { name: /Open photo 2 of 3/ }));
    expect(lightbox()?.open).toBe(true);
    expect(caption()).toBe("Photo 2 of 3");
    expect(within(lightbox() as HTMLElement).getByRole("img")).toHaveAccessibleName("Photo 2 description");
    expect(lightbox()).toHaveTextContent("Photo: A. Photographer, CC BY 4.0");

    await user.click(screen.getByRole("button", { name: "Next photo" }));
    expect(caption()).toBe("Photo 3 of 3");
    await user.keyboard("{ArrowRight}");
    expect(caption()).toBe("Photo 1 of 3");
    await user.keyboard("{ArrowLeft}");
    expect(caption()).toBe("Photo 3 of 3");
    await user.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(caption()).toBe("Photo 2 of 3");
  });

  it.each([
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
    [
      "Close",
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole("button", { name: "Close photos" })),
    ],
  ])("%s closes it and returns focus to the photo last shown", async (_, close) => {
    const user = userEvent.setup();
    render(<Gallery media={[photo(1), photo(2), photo(3)]} label="Test Reserve" />);
    await user.click(screen.getByRole("button", { name: /Open photo 1 of 3/ }));
    await user.keyboard("{ArrowRight}");
    await close(user);
    expect(lightbox()).toBeNull();
    expect(screen.getByRole("button", { name: /Open photo 2 of 3/ })).toHaveFocus();
  });

  it("has no previous/next for a single photo", async () => {
    const user = userEvent.setup();
    render(<Gallery media={[photo(1)]} label="Test Reserve" />);
    await user.click(screen.getByRole("button", { name: /Open photo 1 of 1/ }));
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(caption()).toBe("Photo 1 of 1");
  });

  it("replaces a photo that fails to load with a placeholder in the same box", () => {
    render(<Gallery media={[photo(1), photo(2)]} label="Test Reserve" />);
    const button = screen.getByRole("button", { name: /Open photo 1 of 2/ });
    fireEvent.error(within(button).getByRole("img"));
    // Same button, same box: only its content changes, so the layout doesn't shift.
    expect(screen.getByRole("button", { name: /Open photo 1 of 2/ })).toBe(button);
    expect(button).toHaveTextContent("Photo unavailable");
    expect(within(button).queryByRole("img")).toBeNull();
    expect(button.className).toContain("aspect-");
  });
});
