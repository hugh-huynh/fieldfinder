import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../../../../tests/msw/server";
import { searchHandler, venueResult } from "../../../../tests/msw/venues";
import { SearchMap } from "@/features/map/components/SearchMap";

import { ResultsPanel } from "./ResultsPanel";
import { SearchLayout } from "./SearchLayout";
import { SearchResultsProvider } from "./SearchResultsContext";

// The mobile results sheet (PR 3.8): three snaps reached by buttons and the keyboard splitter, each
// change announced; the map stays the same element throughout; choosing a marker from the
// list-focused view and focusing into a peeking list make room. Dragging needs a real browser
// (E2E). jsdom has no matchMedia: it's stubbed to a phone width here.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("lat=-37.814&lng=144.963&place=Melbourne"),
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MAP_ADAPTER", "fake");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  server.use(searchHandler([{ items: [venueResult(1), venueResult(2)], totalCount: 2, nextCursor: null }]));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function renderPage() {
  render(
    <SearchResultsProvider>
      <SearchLayout map={<SearchMap />} list={<ResultsPanel />} />
    </SearchResultsProvider>,
  );
}

const splitter = () => screen.getByRole("separator", { name: "Resize results" });
const sizeButton = (name: string) =>
  within(screen.getByRole("group", { name: "Results size" })).getByRole("button", { name });
const announced = () =>
  screen
    .getAllByRole("status")
    .map((s) => s.textContent)
    .join(" | ");

describe("SearchLayout on a phone", () => {
  it("starts balanced, and the buttons reach every snap, announcing each", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("list", { name: "Venues" });
    expect(splitter()).toHaveAttribute("aria-valuetext", "Split view");
    expect(sizeButton("Split")).toHaveAttribute("aria-pressed", "true");
    expect(splitter()).toHaveAttribute("aria-controls", document.querySelector("[data-results-scroller]")?.id);

    await user.click(sizeButton("List"));
    expect(splitter()).toHaveAttribute("aria-valuenow", "2");
    expect(sizeButton("List")).toHaveAttribute("aria-pressed", "true");
    expect(announced()).toContain("Showing the list");

    await user.click(sizeButton("Map"));
    expect(splitter()).toHaveAttribute("aria-valuetext", "Map view");
    expect(announced()).toContain("Showing the map");
  });

  it("the splitter moves with the arrows, Home and End", async () => {
    const user = userEvent.setup();
    renderPage();
    splitter().focus();
    await user.keyboard("{ArrowUp}");
    expect(splitter()).toHaveAttribute("aria-valuetext", "List view");
    await user.keyboard("{ArrowUp}");
    expect(splitter()).toHaveAttribute("aria-valuetext", "List view");
    await user.keyboard("{Home}");
    expect(splitter()).toHaveAttribute("aria-valuetext", "Map view");
    await user.keyboard("{ArrowDown}");
    expect(splitter()).toHaveAttribute("aria-valuetext", "Map view");
    await user.keyboard("{End}");
    expect(splitter()).toHaveAttribute("aria-valuetext", "List view");
  });

  it("keeps the same map the whole time", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("list", { name: "Venues" });
    const map = screen.getByTestId("fake-map");
    for (const name of ["List", "Map", "Split"]) {
      await user.click(sizeButton(name));
      expect(screen.getByTestId("fake-map")).toBe(map);
    }
  });

  it("makes room for the map when a marker is chosen from the list view", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("list", { name: "Venues" });
    await user.click(sizeButton("List"));
    await user.click(screen.getByRole("button", { name: "Test Venue 1, 2 pitches" }));
    expect(splitter()).toHaveAttribute("aria-valuetext", "Split view");
    expect(screen.getByRole("dialog", { name: "Test Venue 1" })).toBeInTheDocument();
  });

  it("grows a peeking list when keyboard focus moves into it", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("list", { name: "Venues" });
    await user.click(sizeButton("Map"));
    screen.getByRole("link", { name: "Test Venue 1" }).focus();
    await waitFor(() => {
      expect(splitter()).toHaveAttribute("aria-valuetext", "Split view");
    });
  });
});
