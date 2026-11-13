import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

// `/` (PR 3.2 frame): one h1 that follows the URL's place; results arrive in 3.3.

async function renderPage(params: Record<string, string | string[]>) {
  render(await HomePage({ searchParams: Promise.resolve(params) }));
}

describe("HomePage", () => {
  it("asks for a place when the URL has none", async () => {
    await renderPage({});
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Find a soccer field");
  });

  it("names the URL's place", async () => {
    await renderPage({ lat: "-37.767", lng: "144.962", place: "Brunswick, Victoria 3056" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Soccer fields near Brunswick, Victoria 3056");
  });

  it("copes with a place without a label, and with bad or repeated parameters", async () => {
    await renderPage({ lat: ["-37.767", "1"], lng: "144.962", radiusKm: "999" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Soccer fields near the selected place");
  });
});
