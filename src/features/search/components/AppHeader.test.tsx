import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../../../../tests/msw/server";
import { suggestHandler } from "../../../../tests/msw/suggest";

import { AppHeader } from "./AppHeader";

// The header on every page (PR 3.2): wordmark, exactly one location search and exactly one Filters
// button beside it (spec §3, CLAUDE.md rule 6), and nothing the spec forbids (rule 4).

const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  push.mockReset();
  search = "";
});

describe("AppHeader", () => {
  it("has the wordmark linking home, one search box and one Filters button, side by side", () => {
    render(<AppHeader />);
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "FieldFinder" })).toHaveAttribute("href", "/");
    expect(within(banner).getAllByRole("combobox")).toHaveLength(1);
    expect(within(banner).queryAllByRole("textbox")).toHaveLength(0);
    const filters = within(banner).getAllByRole("button", { name: /Filters/ });
    expect(filters).toHaveLength(1);
    // Directly beside: the same search landmark, next in order after the box.
    const searchRegion = within(banner).getByRole("search", { name: "Find soccer fields" });
    expect(within(searchRegion).getByRole("combobox")).toBeInTheDocument();
    expect(within(searchRegion).getByRole("button", { name: /Filters/ })).toBe(filters[0]);
    expect(within(banner).getAllByRole("button")).toHaveLength(1);
  });

  it("offers no forbidden controls", () => {
    render(<AppHeader />);
    for (const name of [/sort/i, /log ?in/i, /sign ?in/i, /saved/i, /date/i, /players/i, /time/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
  });

  it("shows the URL's place in the box", () => {
    search = "lat=-37.767&lng=144.962&place=Brunswick%2C+Victoria+3056";
    render(<AppHeader />);
    expect(screen.getByRole("combobox")).toHaveValue("Brunswick, Victoria 3056");
  });

  it.each([
    ["", "Filters"],
    ["surface=grass", "Filters, 1 active"],
    ["radiusKm=25&lighting=yes&amenities=parking,toilets", "Filters, 4 active"],
  ])("names the Filters button by its active count (%s)", (query, name) => {
    search = query;
    render(<AppHeader />);
    const button = screen.getByRole("button", { name });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveTextContent(name === "Filters" ? "Filters" : `Filters${name.replace(/\D/g, "")}`);
  });

  it("goes to the results for a chosen place, keeping the current filters", async () => {
    server.use(suggestHandler());
    search = "lat=-37.814&lng=144.963&place=Melbourne&surface=grass&radiusKm=25";
    const user = userEvent.setup();
    render(<AppHeader />);
    const input = screen.getByRole("combobox");
    await user.clear(input);
    await user.type(input, "Brunswick E");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledExactlyOnceWith(
      "/?lat=-37.772&lng=144.979&place=Brunswick+East,+Victoria+3057&radiusKm=25&surface=grass",
    );
  });

  it("keeps keyboard focus in the same box after a choice updates the URL", async () => {
    server.use(suggestHandler());
    const user = userEvent.setup();
    const { rerender } = render(<AppHeader />);
    const input = screen.getByRole("combobox");
    await user.type(input, "Brunswick E");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");
    // The router navigates: the new URL's params reach the header.
    search = String(push.mock.calls[0]?.[0]).replace(/^\/\?/, "");
    rerender(<AppHeader />);
    expect(screen.getByRole("combobox")).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Brunswick East, Victoria 3057");
  });
});
