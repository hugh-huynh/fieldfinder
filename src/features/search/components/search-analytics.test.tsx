import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAnalytics } from "@/features/analytics/gtag";
import { SearchMap } from "@/features/map/components/SearchMap";

import { server } from "../../../../tests/msw/server";
import { searchHandler, venueResult } from "../../../../tests/msw/venues";
import { setDeviceFix } from "../device-fix";

import { ResultsPanel } from "./ResultsPanel";
import { SearchBar } from "./SearchBar";
import { SearchResultsProvider } from "./SearchResultsContext";

// The search page's GA4 events (spec §7, PR 4.1): a search event once per place, no_search_results,
// choosing a marker and applying filters. Never the place, its label or coordinates.

let search = "";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => router,
  usePathname: () => "/",
}));

const VENUE_1 = venueResult(1, { name: "North Reserve", publishedPitchCount: 1 });
const VENUE_2 = venueResult(2, { name: "South Oval", publishedPitchCount: 2 });

function layer(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}
/** The events sent, without the page_location every one carries. */
function sent(): [unknown, Record<string, unknown>][] {
  return layer()
    .filter((entry) => entry[0] === "event")
    .map((entry) => {
      const params = { ...(entry[2] as Record<string, unknown>) };
      delete params.page_location;
      return [entry[1], params];
    });
}

function renderSearch() {
  return render(
    <SearchResultsProvider>
      <SearchMap />
      <ResultsPanel />
    </SearchResultsProvider>,
  );
}

beforeEach(() => {
  search = "lat=-37.814&lng=144.963&place=12+Smith+St%2C+Fitzroy";
  vi.stubEnv("NEXT_PUBLIC_MAP_ADAPTER", "fake");
  startAnalytics("G-TEST12345", "https://fieldfinder.example/", null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setDeviceFix(null);
});

describe("search events", () => {
  it("sends search_fields once results arrive, with the count and filters but never the place", async () => {
    server.use(searchHandler([{ items: [VENUE_1, VENUE_2], totalCount: 7, nextCursor: "next" }]));
    search += "&radiusKm=5&surface=grass";
    const { rerender } = renderSearch();
    await screen.findByRole("list", { name: "Venues" });
    rerender(
      <SearchResultsProvider>
        <SearchMap />
        <ResultsPanel />
      </SearchResultsProvider>,
    );
    // Sent from an effect once the results arrive, which may land just after the list renders.
    await waitFor(() => {
      expect(sent()).toEqual([
        [
          "search_fields",
          { search_type: "place", result_count: 7, radius_km: 5, filter_count: 2, filter_types: "radius,surface" },
        ],
      ]);
    });
    expect(JSON.stringify(layer())).not.toMatch(/Smith|Fitzroy|-37\.8|144\.9/);
  });

  it("sends nearby_search for the device's own location", async () => {
    setDeviceFix({ lat: -37.81412, lng: 144.96321 });
    search = "lat=-37.81&lng=144.96&place=Your+location";
    server.use(searchHandler([{ items: [VENUE_1], totalCount: 1, nextCursor: null }]));
    renderSearch();
    await screen.findByRole("list", { name: "Venues" });
    // Sent from an effect once the results arrive, which may land just after the list renders.
    await waitFor(() => {
      expect(sent()).toEqual([
        ["nearby_search", { result_count: 1, radius_km: 10, filter_count: 0, filter_types: "none" }],
      ]);
    });
  });

  it("sends a map-area search as search_fields of type area, and no_search_results when nothing is found", async () => {
    search = "lat=-37.814&lng=144.963";
    server.use(searchHandler([{ items: [], totalCount: 0, nextCursor: null }]));
    renderSearch();
    await screen.findByText("No venues found.");
    // Sent from an effect once the results arrive, which may land just after the list renders.
    await waitFor(() => {
      expect(sent()).toEqual([
        [
          "search_fields",
          { search_type: "area", result_count: 0, radius_km: 10, filter_count: 0, filter_types: "none" },
        ],
        ["no_search_results", { search_type: "area", radius_km: 10, filter_count: 0, filter_types: "none" }],
      ]);
    });
  });

  it("sends no_search_results again on returning to an empty search after one with results", async () => {
    // Same place: radius 5 km finds nothing, 10 km finds a venue.
    server.use(
      http.get("*/api/venues", ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("radiusKm") === "5"
            ? { items: [], totalCount: 0, nextCursor: null }
            : { items: [VENUE_1], totalCount: 1, nextCursor: null },
        ),
      ),
    );
    const base = search;
    const tree = () => (
      <SearchResultsProvider>
        <SearchMap />
        <ResultsPanel />
      </SearchResultsProvider>
    );
    search = `${base}&radiusKm=5`;
    const { rerender } = render(tree());
    await screen.findByText("No venues found.");
    await waitFor(() => {
      expect(sent().filter(([name]) => name === "no_search_results")).toHaveLength(1);
    });
    search = base;
    rerender(tree());
    await screen.findByRole("list", { name: "Venues" });
    search = `${base}&radiusKm=5`;
    rerender(tree());
    await screen.findByText("No venues found.");
    await waitFor(() => {
      expect(sent().filter(([name]) => name === "no_search_results")).toHaveLength(2);
    });
    // A rerender of the same empty search doesn't count it again.
    rerender(tree());
    expect(sent().filter(([name]) => name === "no_search_results")).toHaveLength(2);
  });

  it("sends select_map_marker on choosing a marker, not on closing its preview", async () => {
    server.use(searchHandler([{ items: [VENUE_1, VENUE_2], totalCount: 2, nextCursor: null }]));
    const user = userEvent.setup();
    renderSearch();
    await screen.findByRole("list", { name: "Venues" });
    const map = screen.getByRole("region", { name: "Map of venues" });
    await user.click(within(map).getByRole("button", { name: "South Oval, 2 pitches" }));
    await user.click(within(map).getByRole("button", { name: "South Oval, 2 pitches" }));
    expect(sent().filter(([name]) => name === "select_map_marker")).toEqual([
      ["select_map_marker", { venue_id: VENUE_2.id, source: "map" }],
    ]);
  });

  it("marks result cards and the map preview as where a venue page was opened from", async () => {
    server.use(searchHandler([{ items: [VENUE_1], totalCount: 1, nextCursor: null }]));
    const user = userEvent.setup();
    renderSearch();
    const list = await screen.findByRole("list", { name: "Venues" });
    expect(within(list).getByRole("link", { name: "North Reserve" })).toHaveAttribute("data-analytics-source", "list");
    await user.click(
      within(screen.getByRole("region", { name: "Map of venues" })).getByRole("button", {
        name: "North Reserve, 1 pitch",
      }),
    );
    const preview = await screen.findByRole("dialog", { name: "North Reserve" });
    expect(within(preview).getByRole("link", { name: "North Reserve" })).toHaveAttribute(
      "data-analytics-source",
      "map",
    );
  });
});

describe("filter_fields", () => {
  it("is sent when filters are applied, with which filters are on", async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    await user.click(screen.getByRole("radio", { name: "Grass" }));
    await user.click(screen.getByRole("checkbox", { name: "Toilets" }));
    await user.click(screen.getByRole("button", { name: "Show venues" }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalled();
    });
    expect(sent()).toEqual([["filter_fields", { radius_km: 10, filter_count: 2, filter_types: "surface,amenities" }]]);
  });
});
