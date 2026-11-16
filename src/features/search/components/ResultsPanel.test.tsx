import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../../../../tests/msw/server";
import { searchHandler, venueResult } from "../../../../tests/msw/venues";

import { ResultsPanel } from "./ResultsPanel";
import { SearchResultsProvider } from "./SearchResultsContext";

// Results list (PR 3.3) against a mocked GET /api/venues: loading, results, error + Retry, no
// results, Show more, and stale answers.

let search = "lat=-37.814&lng=144.963&place=Melbourne";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  search = "lat=-37.814&lng=144.963&place=Melbourne";
});

const page = (ids: number[], totalCount: number, nextCursor: string | null) => ({
  items: ids.map((n) => venueResult(n)),
  totalCount,
  nextCursor,
});

const venueNames = () =>
  within(screen.getByRole("list", { name: "Venues" }))
    .getAllByRole("heading", { level: 2 })
    .map((h) => h.textContent);

describe("ResultsPanel", () => {
  it("shows skeletons while loading, then the venues, asking with the API's canonical query", async () => {
    const asked: string[] = [];
    search = "surface=grass&place=Melbourne&lng=144.963&lat=-37.814&utm_source=x";
    server.use(searchHandler([page([1, 2], 2, null)], { asked, wait: 50 }));
    render(<ResultsPanel />, { wrapper: SearchResultsProvider });
    expect(screen.getByRole("status")).toHaveTextContent("Loading venues…");
    expect(await screen.findByRole("list", { name: "Venues" })).toBeInTheDocument();
    expect(venueNames()).toEqual(["Test Venue 1", "Test Venue 2"]);
    expect(screen.getByRole("status")).toHaveTextContent("2 venues found.");
    expect(asked).toEqual(["lat=-37.814&lng=144.963&surface=grass"]);
    expect(screen.queryByRole("button", { name: "Show more venues" })).toBeNull();
  });

  it("offers Retry after an error, and Retry asks again", async () => {
    const asked: string[] = [];
    server.use(searchHandler([], { asked, status: 500 }));
    const user = userEvent.setup();
    render(<ResultsPanel />, { wrapper: SearchResultsProvider });
    expect(await screen.findByText("Couldn't load venues.", { selector: "p:not([role])" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't load venues.");

    server.use(searchHandler([page([1], 1, null)], { asked }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("list", { name: "Venues" })).toBeInTheDocument();
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBe(asked[1]);
  });

  describe("no results", () => {
    const openFilters = vi.fn();

    function renderWithHeaderControls() {
      render(
        <>
          <div role="search">
            <input
              role="combobox"
              aria-label="Search a suburb or place"
              aria-controls="places"
              aria-expanded="false"
              defaultValue="Melbourne"
            />
            <button type="button" aria-haspopup="dialog" onClick={openFilters}>
              Filters
            </button>
          </div>
          <ResultsPanel />
        </>,
        { wrapper: SearchResultsProvider },
      );
    }

    it("says so and hands the person to the search box or the Filters button", async () => {
      server.use(searchHandler([page([], 0, null)]));
      const user = userEvent.setup();
      renderWithHeaderControls();
      expect(await screen.findByText("No venues match this search.")).toBeVisible();
      expect(screen.getByRole("status")).toHaveTextContent("No venues found.");

      await user.click(screen.getByRole("button", { name: "Search another area" }));
      expect(screen.getByRole("combobox")).toHaveFocus();
      // "Edit filters" presses the header's Filters button, which opens the dialog (3.7).
      await user.click(screen.getByRole("button", { name: "Edit filters" }));
      expect(openFilters).toHaveBeenCalledTimes(1);
    });

    it("suggests fewer filters only when filters are on", async () => {
      server.use(searchHandler([page([], 0, null)]));
      search += "&surface=grass";
      renderWithHeaderControls();
      expect(await screen.findByText(/Try fewer filters/)).toBeVisible();
    });
  });

  it("shows more venues, skips repeats, moves focus to the first new one, and ends when there are no more", async () => {
    const asked: string[] = [];
    server.use(searchHandler([page([1, 2], 4, "c1"), { ...page([2, 3], 4, "c2") }, page([4], 4, null)], { asked }));
    const user = userEvent.setup();
    render(<ResultsPanel />, { wrapper: SearchResultsProvider });
    await screen.findByRole("list", { name: "Venues" });
    expect(screen.getByText("Showing 2 of 4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show more venues" }));
    await waitFor(() => {
      expect(venueNames()).toEqual(["Test Venue 1", "Test Venue 2", "Test Venue 3"]);
    });
    expect(screen.getByRole("link", { name: "Test Venue 3" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Show more venues" }));
    await waitFor(() => {
      expect(venueNames()).toEqual(["Test Venue 1", "Test Venue 2", "Test Venue 3", "Test Venue 4"]);
    });
    expect(screen.queryByRole("button", { name: "Show more venues" })).toBeNull();
    expect(asked.map((q) => new URLSearchParams(q).get("cursor"))).toEqual([null, "c1", "c2"]);
  });

  it("keeps the list and offers to try again when Show more fails", async () => {
    server.use(searchHandler([page([1, 2], 3, "c1")]));
    const user = userEvent.setup();
    render(<ResultsPanel />, { wrapper: SearchResultsProvider });
    await screen.findByRole("list", { name: "Venues" });
    server.use(searchHandler([], { status: 503 }));
    await user.click(screen.getByRole("button", { name: "Show more venues" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load more venues.");
    expect(venueNames()).toEqual(["Test Venue 1", "Test Venue 2"]);

    server.use(searchHandler([page([1, 2], 3, "c1"), page([3], 3, null)]));
    await user.click(screen.getByRole("button", { name: "Show more venues" }));
    await waitFor(() => {
      expect(venueNames()).toEqual(["Test Venue 1", "Test Venue 2", "Test Venue 3"]);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never lets a slow answer for an older search replace the current one", async () => {
    const { http, HttpResponse, delay } = await import("msw");
    server.use(
      http.get("*/api/venues", async ({ request }) => {
        const grass = new URL(request.url).searchParams.get("surface") === "grass";
        if (!grass) await delay(300);
        return HttpResponse.json(page(grass ? [9] : [1], 1, null));
      }),
    );
    const { rerender } = render(<ResultsPanel />, { wrapper: SearchResultsProvider });
    search += "&surface=grass";
    act(() => {
      rerender(<ResultsPanel />);
    });
    await screen.findByRole("list", { name: "Venues" });
    await new Promise((r) => setTimeout(r, 400));
    expect(venueNames()).toEqual(["Test Venue 9"]);
  });
});
