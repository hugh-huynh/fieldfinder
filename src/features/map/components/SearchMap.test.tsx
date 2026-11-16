import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../../../../tests/msw/server";
import { searchHandler, venueResult } from "../../../../tests/msw/venues";
import { ResultsPanel } from "@/features/search/components/ResultsPanel";
import { SearchResultsProvider } from "@/features/search/components/SearchResultsContext";

import { SearchMap } from "./SearchMap";

// The map beside the list (PR 3.4), drawn by FakeMap: one marker per loaded venue, list hover/focus
// highlights its marker, choosing a marker draws it larger and darker, Recentre and zoom.

let search = "lat=-37.814&lng=144.963&place=Melbourne";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  search = "lat=-37.814&lng=144.963&place=Melbourne";
  vi.stubEnv("NEXT_PUBLIC_MAP_ADAPTER", "fake");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const venues = [
  venueResult(1, { name: "North Reserve", publishedPitchCount: 1 }),
  venueResult(2, { name: "Royal Test Park", publishedPitchCount: 4, matchingPitchCount: 2 }),
  venueResult(3, { name: "South Oval", publishedPitchCount: 2 }),
];

function renderSearch() {
  return render(
    <SearchResultsProvider>
      <SearchMap />
      <ResultsPanel />
    </SearchResultsProvider>,
  );
}

const map = () => screen.getByRole("region", { name: "Map of venues" });
const marker = (name: string) => within(map()).getByRole("button", { name });
const markerNames = () =>
  within(map())
    .queryAllByRole("button", { name: /pitch/ })
    .map((b) => b.getAttribute("aria-label"));
const fakeMap = () => screen.getByTestId("fake-map");

describe("SearchMap", () => {
  it("shows one marker per loaded venue, in list order, named by venue and published pitch count", async () => {
    server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
    renderSearch();
    await screen.findByRole("list", { name: "Venues" });
    expect(markerNames()).toEqual(["North Reserve, 1 pitch", "Royal Test Park, 4 pitches", "South Oval, 2 pitches"]);
    expect(marker("Royal Test Park, 4 pitches")).toHaveTextContent(/^4$/);
  });

  it("has no markers while loading or after an error", async () => {
    server.use(searchHandler([], { status: 500 }));
    renderSearch();
    expect(markerNames()).toEqual([]);
    await screen.findByRole("button", { name: "Retry" });
    expect(markerNames()).toEqual([]);
  });

  it("highlights a venue's marker while its card is hovered or focused, and only then", async () => {
    server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
    const user = userEvent.setup();
    renderSearch();
    const list = await screen.findByRole("list", { name: "Venues" });
    // The list's own items (each card has lists of its own inside).
    const cards = [...list.children];

    await user.hover(cards[1] as HTMLElement);
    expect(marker("Royal Test Park, 4 pitches")).toHaveAttribute("data-marker-state", "highlighted");
    expect(marker("North Reserve, 1 pitch")).toHaveAttribute("data-marker-state", "default");

    await user.hover(cards[2] as HTMLElement);
    expect(marker("Royal Test Park, 4 pitches")).toHaveAttribute("data-marker-state", "default");
    expect(marker("South Oval, 2 pitches")).toHaveAttribute("data-marker-state", "highlighted");

    await user.unhover(cards[2] as HTMLElement);
    expect(marker("South Oval, 2 pitches")).toHaveAttribute("data-marker-state", "default");

    within(list).getByRole("link", { name: "North Reserve" }).focus();
    await waitFor(() => {
      expect(marker("North Reserve, 1 pitch")).toHaveAttribute("data-marker-state", "highlighted");
    });
    within(list).getByRole("link", { name: "North Reserve" }).blur();
    await waitFor(() => {
      expect(marker("North Reserve, 1 pitch")).toHaveAttribute("data-marker-state", "default");
    });
  });

  it("draws a chosen marker larger and darker, above a highlighted one, and un-chooses it on a second click", async () => {
    server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
    const user = userEvent.setup();
    renderSearch();
    await screen.findByRole("list", { name: "Venues" });

    await user.click(marker("South Oval, 2 pitches"));
    const chosen = marker("South Oval, 2 pitches");
    expect(chosen).toHaveAttribute("aria-expanded", "true");
    expect(chosen).toHaveAttribute("data-marker-state", "selected");
    expect(chosen.className).toContain("scale-125");
    expect(chosen.className).toContain("bg-primary-dark");
    // Choosing a marker doesn't navigate (that's the preview's job, 3.5): the list is still here.
    expect(screen.getByRole("list", { name: "Venues" })).toBeInTheDocument();

    await user.click(marker("North Reserve, 1 pitch"));
    expect(marker("South Oval, 2 pitches")).toHaveAttribute("aria-expanded", "false");
    expect(marker("North Reserve, 1 pitch")).toHaveAttribute("aria-expanded", "true");

    await user.click(marker("North Reserve, 1 pitch"));
    expect(marker("North Reserve, 1 pitch")).toHaveAttribute("aria-expanded", "false");
  });

  it("zooms with the buttons, and Recentre goes back to the search's area", async () => {
    server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
    const user = userEvent.setup();
    renderSearch();
    await screen.findByRole("list", { name: "Venues" });
    const fitted = fakeMap().dataset.viewKey;

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(fakeMap()).toHaveAttribute("data-zoom-steps", "1");

    await user.click(screen.getByRole("button", { name: "Recentre map" }));
    expect(fakeMap()).toHaveAttribute("data-zoom-steps", "0");
    expect(fakeMap().dataset.viewKey).not.toBe(fitted);
  });

  it("adds markers for 'Show more' without moving the map", async () => {
    // The next page's venue is far outside the fitted view, so the bounds grow.
    const far = venueResult(4, { name: "Far Field", location: { latitude: -38.6, longitude: 146.2 } });
    server.use(
      searchHandler([
        { items: venues.slice(0, 2), totalCount: 3, nextCursor: "c1" },
        { items: [far], totalCount: 3, nextCursor: null },
      ]),
    );
    const user = userEvent.setup();
    renderSearch();
    await screen.findByRole("list", { name: "Venues" });
    expect(markerNames()).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const view = fakeMap().dataset.viewKey;
    const position = () => (marker("North Reserve, 1 pitch").parentElement as HTMLElement).style.cssText;
    const before = position();

    await user.click(screen.getByRole("button", { name: "Show more venues" }));
    await waitFor(() => {
      expect(markerNames()).toHaveLength(3);
    });
    expect(fakeMap().dataset.viewKey).toBe(view);
    expect(fakeMap()).toHaveAttribute("data-zoom-steps", "1");
    expect(position()).toBe(before);
  });

  it("drops the old search's choice and highlight even when the new search has the same venue", async () => {
    server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
    const user = userEvent.setup();
    const { rerender } = renderSearch();
    const list = await screen.findByRole("list", { name: "Venues" });
    await user.click(marker("South Oval, 2 pitches"));
    within(list).getByRole("link", { name: "North Reserve" }).focus();
    await waitFor(() => {
      expect(marker("North Reserve, 1 pitch")).toHaveAttribute("data-marker-state", "highlighted");
    });
    expect(marker("South Oval, 2 pitches")).toHaveAttribute("aria-expanded", "true");

    // A wider radius: same place, same venues back.
    search = "lat=-37.814&lng=144.963&place=Melbourne&radiusKm=20";
    rerender(
      <SearchResultsProvider>
        <SearchMap />
        <ResultsPanel />
      </SearchResultsProvider>,
    );
    await waitFor(() => {
      expect(markerNames()).toHaveLength(3);
    });
    expect(marker("South Oval, 2 pitches")).toHaveAttribute("aria-expanded", "false");
    expect(marker("South Oval, 2 pitches")).toHaveAttribute("data-marker-state", "default");
    expect(marker("North Reserve, 1 pitch")).toHaveAttribute("data-marker-state", "default");
  });

  it("fits the map again for a new search, and drops the old search's choice", async () => {
    server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
    const user = userEvent.setup();
    const { rerender } = renderSearch();
    await screen.findByRole("list", { name: "Venues" });
    await user.click(marker("South Oval, 2 pitches"));
    expect(screen.getByRole("dialog", { name: "South Oval" })).toBeInTheDocument();
    const view = fakeMap().dataset.viewKey;

    server.use(searchHandler([{ items: [venueResult(9, { name: "Other Park" })], totalCount: 1, nextCursor: null }]));
    search = "lat=-37.7&lng=145.0&place=Elsewhere";
    rerender(
      <SearchResultsProvider>
        <SearchMap />
        <ResultsPanel />
      </SearchResultsProvider>,
    );
    await waitFor(() => {
      expect(markerNames()).toEqual(["Other Park, 2 pitches"]);
    });
    expect(fakeMap().dataset.viewKey).not.toBe(view);
    expect(marker("Other Park, 2 pitches")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("marker preview (3.5)", () => {
    // One venue with a single published pitch (its href is the pitch page) and one with several, of
    // which only one matches the filters (its href is still the venue page: routing ignores filters).
    const single = venueResult(1, {
      name: "Single Pitch Reserve",
      publishedPitchCount: 1,
      matchingPitchCount: 1,
      href: "/venues/single-pitch-reserve/pitches/main-pitch",
    });
    const multi = venueResult(2, {
      name: "Multi Pitch Park",
      publishedPitchCount: 4,
      matchingPitchCount: 1,
      distanceMeters: 2100,
      href: "/venues/multi-pitch-park",
    });

    async function openSearch() {
      server.use(searchHandler([{ items: [single, multi], totalCount: 2, nextCursor: null }]));
      const user = userEvent.setup();
      renderSearch();
      await screen.findByRole("list", { name: "Venues" });
      return user;
    }

    const preview = () => screen.queryByRole("dialog");

    it("opens on the first click and moves focus to it, without navigating", async () => {
      const user = await openSearch();
      expect(preview()).toBeNull();
      await user.click(marker("Multi Pitch Park, 4 pitches"));

      const dialog = screen.getByRole("dialog", { name: "Multi Pitch Park" });
      const link = within(dialog).getByRole("link", { name: "Multi Pitch Park" });
      expect(link).toHaveFocus();
      expect(dialog).toHaveTextContent("1 of 4 pitches match");
      expect(dialog).toHaveTextContent("2.1 km");
      expect(marker("Multi Pitch Park, 4 pitches")).toHaveAttribute("aria-expanded", "true");
      expect(marker("Multi Pitch Park, 4 pitches")).toHaveAttribute("aria-haspopup", "dialog");
    });

    it("links to the pitch page for a single-pitch venue and the venue page otherwise, whatever matches", async () => {
      const user = await openSearch();
      await user.click(marker("Single Pitch Reserve, 1 pitch"));
      expect(within(screen.getByRole("dialog")).getByRole("link")).toHaveAttribute(
        "href",
        "/venues/single-pitch-reserve/pitches/main-pitch",
      );
      await user.click(marker("Multi Pitch Park, 4 pitches"));
      expect(within(screen.getByRole("dialog")).getByRole("link")).toHaveAttribute("href", "/venues/multi-pitch-park");
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    it("closes on Escape and puts focus back on its marker", async () => {
      const user = await openSearch();
      await user.click(marker("Multi Pitch Park, 4 pitches"));
      await user.keyboard("{Escape}");
      expect(preview()).toBeNull();
      expect(marker("Multi Pitch Park, 4 pitches")).toHaveFocus();
      expect(marker("Multi Pitch Park, 4 pitches")).toHaveAttribute("aria-expanded", "false");
    });

    it("closes with its Close button, putting focus back on the marker", async () => {
      const user = await openSearch();
      await user.click(marker("Single Pitch Reserve, 1 pitch"));
      await user.click(screen.getByRole("button", { name: "Close preview" }));
      expect(preview()).toBeNull();
      expect(marker("Single Pitch Reserve, 1 pitch")).toHaveFocus();
    });

    it("works from the keyboard: Enter on a marker opens it, Tab stays inside the page order", async () => {
      const user = await openSearch();
      marker("Single Pitch Reserve, 1 pitch").focus();
      await user.keyboard("{Enter}");
      expect(within(screen.getByRole("dialog")).getByRole("link")).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("button", { name: "Close preview" })).toHaveFocus();
    });

    it("closes when its marker is clicked again", async () => {
      const user = await openSearch();
      await user.click(marker("Single Pitch Reserve, 1 pitch"));
      await user.click(marker("Single Pitch Reserve, 1 pitch"));
      expect(preview()).toBeNull();
    });
  });

  describe("when there's no map", () => {
    it.each([
      ["no token", undefined],
      ["a secret token", "sk.not-a-real-token"],
    ])("says so for %s, and the list still works", async (_, token) => {
      vi.stubEnv("NEXT_PUBLIC_MAP_ADAPTER", undefined);
      vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", token);
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
      renderSearch();
      expect(screen.getByText(/The map isn.t available right now/)).toBeVisible();
      expect(await screen.findByRole("list", { name: "Venues" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Map of venues" })).toBeNull();
    });
  });
});
