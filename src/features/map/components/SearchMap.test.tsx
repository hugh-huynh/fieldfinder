import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDeviceFix } from "@/features/search/device-fix";
import { flushSavedView } from "@/features/search/history-state";

import { server } from "../../../../tests/msw/server";
import { searchHandler, venueResult } from "../../../../tests/msw/venues";
import { ResultsPanel } from "@/features/search/components/ResultsPanel";
import { SearchResultsProvider } from "@/features/search/components/SearchResultsContext";

import { SearchMap } from "./SearchMap";

// The map beside the list (PR 3.4), drawn by FakeMap: one marker per loaded venue, list hover/focus
// highlights its marker, choosing a marker draws it larger and darker, Recentre and zoom.

let search = "lat=-37.814&lng=144.963&place=Melbourne";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => router,
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

  describe("Search this area (3.6)", () => {
    const offer = () => screen.queryByRole("button", { name: "Search this area" });

    it("isn't offered for the search's own view, only after the person moves the map", async () => {
      const asked: string[] = [];
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }], { asked }));
      const user = userEvent.setup();
      renderSearch();
      await screen.findByRole("list", { name: "Venues" });
      expect(offer()).toBeNull();

      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(offer()).toBeVisible();
      // Moving the map never searches by itself.
      expect(asked).toHaveLength(1);
      expect(router.push).not.toHaveBeenCalled();
    });

    it("searches the visible area's centre with a radius covering it, keeping the other filters", async () => {
      search = "lat=-37.814&lng=144.963&place=Melbourne&surface=grass&amenities=toilets";
      server.use(searchHandler([{ items: [], totalCount: 0, nextCursor: null }]));
      const user = userEvent.setup();
      renderSearch();
      await screen.findByText("No venues match this search.");
      // No venues: the view is the 10 km radius box around the place. Zooming in halves it.
      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      await user.click(screen.getByRole("button", { name: "Search this area" }));

      expect(router.push).toHaveBeenCalledTimes(1);
      const url = new URL(String(router.push.mock.calls[0]?.[0]), "http://x");
      expect(url.pathname).toBe("/");
      expect(url.searchParams.get("lat")).toBe("-37.814");
      expect(url.searchParams.get("lng")).toBe("144.963");
      // A 5 km half-width box has corners ≈ 7.07 km out: 8 km covers it.
      expect(url.searchParams.get("radiusKm")).toBe("8");
      expect(url.searchParams.get("surface")).toBe("grass");
      expect(url.searchParams.get("amenities")).toBe("toilets");
      // An area has no place name.
      expect(url.searchParams.get("place")).toBeNull();
    });

    it("asks the person to zoom in when the visible area is too wide to search", async () => {
      server.use(searchHandler([{ items: [], totalCount: 0, nextCursor: null }]));
      const user = userEvent.setup();
      renderSearch();
      await screen.findByText("No venues match this search.");
      await user.click(screen.getByRole("button", { name: "Zoom out" })); // 20 km half-width: ≈ 28 km
      expect(offer()).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Zoom out" })); // 40 km half-width: ≈ 57 km
      expect(offer()).toBeNull();
      expect(screen.getByText("Zoom in to search this area")).toBeVisible();
    });

    it("goes away on Recentre", async () => {
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
      const user = userEvent.setup();
      renderSearch();
      await screen.findByRole("list", { name: "Venues" });
      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      await user.click(screen.getByRole("button", { name: "Recentre map" }));
      expect(offer()).toBeNull();
    });
  });

  describe("coming back to a search (3.6)", () => {
    const KEY = "fieldfinder:search";
    const CANONICAL = "lat=-37.814&lng=144.963";
    // Centred on the test venues' location (-37.8, 144.96).
    const SAVED_BOUNDS = { south: -37.9, west: 144.86, north: -37.7, east: 145.06 };

    const percentLeft = (name: string) => parseFloat(marker(name).parentElement?.style.left ?? "NaN");
    const percentTop = (name: string) => parseFloat(marker(name).parentElement?.style.top ?? "NaN");

    function saveEntry(saved: Record<string, unknown>) {
      window.history.replaceState({ __NA: true, [KEY]: saved }, "", "/");
    }

    it("puts the map back where the person left it, until Recentre", async () => {
      saveEntry({ query: CANONICAL, bounds: SAVED_BOUNDS });
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
      const user = userEvent.setup();
      renderSearch();
      await screen.findByRole("list", { name: "Venues" });
      expect(percentLeft("North Reserve, 1 pitch")).toBeCloseTo(50, 6);
      expect(percentTop("North Reserve, 1 pitch")).toBeCloseTo(50, 6);
      expect(screen.queryByRole("button", { name: "Search this area" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Recentre map" }));
      expect(percentLeft("North Reserve, 1 pitch")).not.toBeCloseTo(50, 1);
    });

    it("still restores another history entry's view after Recentre was pressed on an earlier one", async () => {
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
      const user = userEvent.setup();
      const { rerender } = renderSearch();
      await screen.findByRole("list", { name: "Venues" });
      await user.click(screen.getByRole("button", { name: "Recentre map" }));
      flushSavedView();

      // Back/forward to another search whose entry saved a viewport (the component is kept).
      search = "lat=-37.7&lng=145.0&place=Elsewhere";
      window.history.replaceState(
        { __NA: true, [KEY]: { query: "lat=-37.7&lng=145", bounds: SAVED_BOUNDS } },
        "",
        "/?b",
      );
      rerender(
        <SearchResultsProvider>
          <SearchMap />
          <ResultsPanel />
        </SearchResultsProvider>,
      );
      await waitFor(() => {
        expect(percentLeft("North Reserve, 1 pitch")).toBeCloseTo(50, 6);
      });
      expect(percentTop("North Reserve, 1 pitch")).toBeCloseTo(50, 6);
    });

    it("ignores a view saved for a different search", async () => {
      saveEntry({ query: "lat=-37.7&lng=145", bounds: SAVED_BOUNDS });
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
      renderSearch();
      await screen.findByRole("list", { name: "Venues" });
      expect(percentLeft("North Reserve, 1 pitch")).not.toBeCloseTo(50, 1);
    });

    it("loads as many venues as were showing in one request, then scrolls back", async () => {
      saveEntry({ query: CANONICAL, loaded: 25, scrollY: 640 });
      const asked: string[] = [];
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }], { asked }));
      // The list scrolls in its own container (SearchLayout marks it); jsdom can't scroll, so spy.
      const scrollTo = vi.fn();
      render(
        <SearchResultsProvider>
          <SearchMap />
          <div
            data-results-scroller=""
            ref={(element) => {
              if (element !== null) element.scrollTo = scrollTo;
            }}
          >
            <ResultsPanel />
          </div>
        </SearchResultsProvider>,
      );
      await screen.findByRole("list", { name: "Venues" });
      expect(asked).toEqual([`${CANONICAL}&limit=25`]);
      await waitFor(() => {
        expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: "instant" });
      });
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });

    it("starts a fresh search at the top of the list, but keeps a saved position on return", async () => {
      window.history.replaceState(null, "", "/");
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
      // jsdom doesn't lay out, but it keeps scrollTop as set.
      const scroller: { current: HTMLDivElement | null } = { current: null };
      const tree = () => (
        <SearchResultsProvider>
          <SearchMap />
          <div
            data-results-scroller=""
            ref={(element) => {
              scroller.current = element;
              if (element !== null) element.scrollTo = vi.fn();
            }}
          >
            <ResultsPanel />
          </div>
        </SearchResultsProvider>
      );
      const scrollTop = () => scroller.current?.scrollTop;
      const setScrollTop = (px: number) => {
        if (scroller.current !== null) scroller.current.scrollTop = px;
      };
      const { rerender } = render(tree());
      await screen.findByRole("list", { name: "Venues" });
      setScrollTop(300);
      expect(scrollTop()).toBe(300);

      // Choosing another place: the same scroll container, a new search.
      search = "lat=-37.7&lng=145.0&place=Elsewhere";
      window.history.replaceState({ __NA: true }, "", "/?fresh");
      rerender(tree());
      await waitFor(() => {
        expect(scrollTop()).toBe(0);
      });

      // Back to an entry that saved a position: not reset.
      setScrollTop(300);
      search = "lat=-37.814&lng=144.963&place=Melbourne";
      window.history.replaceState({ __NA: true, [KEY]: { query: CANONICAL, scrollY: 300 } }, "", "/?back");
      rerender(tree());
      await screen.findByRole("list", { name: "Venues" });
      expect(scrollTop()).toBe(300);
    });

    it("never asks for more than one page's worth", async () => {
      saveEntry({ query: CANONICAL, loaded: 90 });
      const asked: string[] = [];
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }], { asked }));
      renderSearch();
      await screen.findByRole("list", { name: "Venues" });
      expect(asked).toEqual([`${CANONICAL}&limit=30`]);
    });

    it("saves the viewport and how many venues are loaded in this history entry", async () => {
      server.use(searchHandler([{ items: venues, totalCount: 3, nextCursor: null }]));
      const user = userEvent.setup();
      renderSearch();
      await screen.findByRole("list", { name: "Venues" });
      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      flushSavedView();
      const saved = (window.history.state as Record<string, { query: string; loaded: number; bounds: object }>)[KEY];
      expect(saved?.query).toBe(CANONICAL);
      expect(saved?.loaded).toBe(3);
      expect(Object.keys(saved?.bounds ?? {}).sort()).toEqual(["east", "north", "south", "west"]);
    });
  });

  describe("near me (3.9)", () => {
    afterEach(() => {
      setDeviceFix(null);
    });

    it("shows distances from the device's precise position, which stays in memory", async () => {
      // The URL has the fix rounded to 2 dp; the venue is about 610 m from the precise fix, though the
      // API (from the rounded centre) says 1.0 km.
      setDeviceFix({ lat: -37.801234, lng: 144.966789 });
      search = "lat=-37.8&lng=144.97&place=Carlton";
      server.use(searchHandler([{ items: [venueResult(1)], totalCount: 1, nextCursor: null }]));
      const user = userEvent.setup();
      renderSearch();
      const list = await screen.findByRole("list", { name: "Venues" });
      expect(list).toHaveTextContent("610 m");
      expect(list).not.toHaveTextContent("1.0 km");
      await user.click(marker("Test Venue 1, 2 pitches"));
      expect(screen.getByRole("dialog")).toHaveTextContent("610 m");
    });

    it("uses the API's distance for any other search", async () => {
      setDeviceFix({ lat: -37.801234, lng: 144.966789 });
      server.use(searchHandler([{ items: [venueResult(1)], totalCount: 1, nextCursor: null }]));
      renderSearch();
      expect(await screen.findByRole("list", { name: "Venues" })).toHaveTextContent("1.0 km");
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
