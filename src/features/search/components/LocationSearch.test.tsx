import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "../../../../tests/msw/server";
import { PLACES, suggestHandler } from "../../../../tests/msw/suggest";

import { LocationSearch } from "./LocationSearch";

// The location combobox (PR 3.2): ARIA 1.2 combobox + listbox, APG "list autocomplete with manual
// selection", debounced and bounded requests to /api/locations/suggest (mocked with MSW).

function setup(initialLabel = "", handler = suggestHandler()) {
  server.use(handler);
  const onSelect = vi.fn();
  const user = userEvent.setup();
  render(<LocationSearch initialLabel={initialLabel} onSelect={onSelect} />);
  const input = screen.getByRole("combobox", { name: "Search a suburb or place" });
  return { user, input, onSelect };
}

const options = () => screen.getAllByRole("option");

describe("LocationSearch", () => {
  it("is a labelled ARIA combobox that starts collapsed", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox", { hidden: true }).id);
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("shows the URL's place without asking for suggestions", async () => {
    const asked: string[] = [];
    const { input } = setup("Brunswick, Victoria 3056", suggestHandler({ asked }));
    expect(input).toHaveValue("Brunswick, Victoria 3056");
    input.focus();
    await new Promise((r) => setTimeout(r, 400));
    expect(asked).toEqual([]);
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("lists suggestions after typing pauses, with one request for the final text", async () => {
    const asked: string[] = [];
    const { user, input } = setup("", suggestHandler({ asked }));
    await user.type(input, "Brun");
    expect(await screen.findByRole("listbox")).toBeVisible();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(options().map((o) => o.textContent)).toEqual(PLACES.map((p) => `${p.name}${p.label}`));
    expect(asked).toEqual(["Brun"]);
    expect(screen.getByRole("status")).toHaveTextContent("3 places found");
  });

  it.each([
    ["one character", "B"],
    ["only symbols the API rejects", "<>!"],
  ])("never asks for %s", async (_name, text) => {
    const asked: string[] = [];
    const { user, input } = setup("", suggestHandler({ asked }));
    await user.type(input, text);
    await new Promise((r) => setTimeout(r, 400));
    expect(asked).toEqual([]);
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("moves through the options with Down and Up, wrapping, and chooses with Enter", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "Brun");
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options()[0]?.id);
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options()[0]?.id); // wrapped
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", options()[2]?.id); // wrapped back
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(PLACES[2]);
    expect(input).toHaveValue(PLACES[2]?.label);
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveFocus();
  });

  it("chooses the first place on Enter when none is highlighted", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "Brun");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(PLACES[0]);
  });

  it("on Enter before the list loads, chooses its first place as soon as it arrives, with one request", async () => {
    const asked: string[] = [];
    const { user, input, onSelect } = setup("", suggestHandler({ asked, wait: 100 }));
    await user.type(input, "Brunswick E{Enter}");
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(PLACES[1]);
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(asked).toEqual(["Brunswick E"]);
  });

  it("does not choose a stale place if the text changed while Enter waited", async () => {
    const { user, input, onSelect } = setup("", suggestHandler({ wait: 150 }));
    await user.type(input, "Brun{Enter}x");
    await new Promise((r) => setTimeout(r, 600));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("chooses with a click and keeps focus in the box", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "Brun");
    await screen.findByRole("listbox");
    await user.click(screen.getByRole("option", { name: /Brunswick West/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(PLACES[2]);
    expect(input).toHaveFocus();
  });

  it("closes on the first Escape and clears the text on the second", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "Brun");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(input).toHaveValue("Brun");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reopens with Alt+Down without highlighting, and closes on Tab without choosing", async () => {
    const { user, input, onSelect } = setup();
    await user.type(input, "Brun");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}{Alt>}{ArrowDown}{/Alt}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    await user.tab();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("says so when nothing matches", async () => {
    const { user, input } = setup();
    await user.type(input, "Zzz");
    expect(await screen.findByText("No matching places in Australia.", { selector: "p:not([role])" })).toBeVisible();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("says so when suggestions can't load, and Enter does nothing", async () => {
    const { user, input, onSelect } = setup("", suggestHandler({ status: 503 }));
    await user.type(input, "Brun");
    expect(await screen.findByText(/Couldn't load places/, { selector: "p:not([role])" })).toBeVisible();
    await user.keyboard("{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ignores a slow answer for an older query", async () => {
    let calls = 0;
    const { user, input } = setup(
      "",
      http.get("*/api/locations/suggest", async ({ request }) => {
        calls += 1;
        const q = new URL(request.url).searchParams.get("q") ?? "";
        if (q === "Brun") await delay(500);
        return HttpResponse.json({
          suggestions: PLACES.filter((p) => p.name.toLowerCase().startsWith(q.toLowerCase())),
        });
      }),
    );
    await user.type(input, "Brun");
    await new Promise((r) => setTimeout(r, 300)); // "Brun" is now in flight
    await user.type(input, "swick W");
    await waitFor(() => {
      expect(options()).toHaveLength(1);
    });
    await new Promise((r) => setTimeout(r, 600)); // the "Brun" answer would have arrived by now
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent("Brunswick West");
    expect(calls).toBe(2);
  });
});
