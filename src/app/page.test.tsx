import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../../tests/msw/server";
import { searchHandler } from "../../tests/msw/venues";

import HomePage from "./page";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  server.use(searchHandler([{ items: [], totalCount: 0, nextCursor: null }]));
});

// `/` (PR 3.2 frame): one h1 that follows the URL's place; results arrive in 3.3.

async function renderPage(params: Record<string, string | string[]>) {
  search = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => [v].flat().map((x) => [k, x]))).toString();
  render(await HomePage({ searchParams: Promise.resolve(params) }));
}

describe("HomePage", () => {
  it("asks for a place when the URL has none", async () => {
    await renderPage({});
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Find a soccer field");
    expect(screen.queryByRole("status")).toBeNull(); // no search, so no results panel
  });

  it("names the URL's place", async () => {
    await renderPage({ lat: "-37.767", lng: "144.962", place: "Brunswick, Victoria 3056" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Soccer fields near Brunswick, Victoria 3056");
    expect(await screen.findByText("No venues match this search.")).toBeVisible();
  });

  it("copes with a place without a label, and with bad or repeated parameters", async () => {
    await renderPage({ lat: ["-37.767", "1"], lng: "144.962", radiusKm: "999" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Soccer fields near the selected place");
  });
});
