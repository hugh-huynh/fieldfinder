import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { defaultFilters, type SearchFilters } from "../state";

import { FiltersControl } from "./FiltersDialog";

// The Filters dialog (PR 3.7): opens only from the button, edits a draft, and applies it only on
// "Show venues". Cancel / X / Escape discard the draft and return focus; Clear all resets the draft.
// jsdom has no real modal behaviour (tests/setup/dom.ts stands in); E2E covers the focus trap.

function setup(filters: Partial<SearchFilters> = {}) {
  const onApply = vi.fn();
  const user = userEvent.setup();
  const applied = { ...defaultFilters(), ...filters };
  const view = render(<FiltersControl filters={applied} onApply={onApply} />);
  const button = () => screen.getByRole("button", { name: /^Filters/ });
  const dialog = () => document.querySelector("dialog");
  return { user, onApply, button, dialog, view };
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("FiltersControl", () => {
  it("is closed until the Filters button opens it, showing the applied filters", async () => {
    const { user, button, dialog } = setup({ surface: "grass", radiusKm: 25, amenities: ["toilets"] });
    expect(dialog()?.open).toBe(false);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(button()).toHaveAccessibleName("Filters, 3 active");

    await user.click(button());
    expect(dialog()?.open).toBe(true);
    expect(within(dialog() as HTMLElement).getByRole("heading", { name: "Filters" })).toBeInTheDocument();
    expect(radio("Grass")).toBeChecked();
    expect(screen.getByRole("slider", { name: "Distance" })).toHaveValue("25");
    expect(screen.getByRole("slider", { name: "Distance" })).toHaveAttribute("aria-valuetext", "Within 25 km");
    expect(screen.getByRole("checkbox", { name: "Toilets" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Parking" })).not.toBeChecked();
  });

  it("has every choice from the spec, with Any as the default", async () => {
    const { user, button } = setup();
    await user.click(button());
    const group = (name: string) =>
      within(screen.getByRole("group", { name }))
        .getAllByRole("radio")
        .map((r) => r.closest("label")?.textContent);
    expect(group("Surface type")).toEqual(["Any", "Grass", "Synthetic", "Hybrid"]);
    expect(group("Pitch size")).toEqual(["Any", "Full size", "Small-sided", "Training"]);
    expect(group("Lighting")).toEqual(["Any", "With lighting", "No lighting"]);
    expect(group("Access type")).toEqual(["Any", "Public access", "Booking required", "Members only"]);
    expect(
      within(screen.getByRole("group", { name: "Facilities" }))
        .getAllByRole("checkbox")
        .map((c) => c.closest("label")?.textContent),
    ).toEqual(["Parking", "Toilets", "Changing rooms", "Drinking water", "Café", "Public transport"]);
    for (const name of ["Surface type", "Pitch size", "Lighting", "Access type"]) {
      expect(within(screen.getByRole("group", { name })).getByRole("radio", { name: "Any" })).toBeChecked();
    }
  });

  it("shows Date & time and Players as unavailable, not as controls (C6)", async () => {
    const { user, button } = setup();
    await user.click(button());
    for (const name of [/Date & time/, /Players/]) {
      const group = screen.getByRole("group", { name });
      expect(group).toHaveAttribute("aria-disabled", "true");
      expect(group).toHaveTextContent("coming soon — not yet available");
      expect(group.querySelectorAll("input, button, select, [tabindex]")).toHaveLength(0);
    }
  });

  it("applies nothing while the draft changes, then everything at once on Show venues", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { user, button, dialog, onApply } = setup();
    await user.click(button());
    await user.click(radio("Synthetic"));
    await user.click(radio("With lighting"));
    await user.click(screen.getByRole("checkbox", { name: "Parking" }));
    // jsdom doesn't move a range input with the arrow keys; E2E drives the real slider.
    fireEvent.change(screen.getByRole("slider", { name: "Distance" }), { target: { value: "12" } });
    expect(screen.getByText("Within 12 km")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Show venues" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      radiusKm: 12,
      surface: "synthetic",
      pitchSize: null,
      lighting: true,
      access: null,
      amenities: ["parking"],
    });
    expect(dialog()?.open).toBe(false);
    expect(button()).toHaveFocus();
  });

  it.each([
    [
      "Cancel",
      async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Cancel" })),
    ],
    [
      "the X",
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole("button", { name: "Close filters" })),
    ],
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
  ])("%s discards the draft and puts focus back on the button", async (_, close) => {
    const { user, button, dialog, onApply } = setup({ surface: "grass" });
    await user.click(button());
    await user.click(radio("Hybrid"));
    await close(user);
    expect(dialog()?.open).toBe(false);
    expect(onApply).not.toHaveBeenCalled();
    expect(button()).toHaveFocus();

    await user.click(button());
    expect(radio("Grass")).toBeChecked();
  });

  it("Clear all resets the draft only; Show venues then applies the defaults", async () => {
    const { user, button, onApply } = setup({ surface: "grass", radiusKm: 30, amenities: ["cafe"] });
    await user.click(button());
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("group", { name: "Surface type" })).getByRole("radio", { name: "Any" }),
    ).toBeChecked();
    expect(screen.getByRole("slider", { name: "Distance" })).toHaveValue("10");
    expect(screen.getByRole("checkbox", { name: "Café" })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Show venues" }));
    expect(onApply).toHaveBeenCalledWith(defaultFilters());
  });

  it("returns focus to whatever opened it (e.g. Edit filters)", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <FiltersControl filters={defaultFilters()} onApply={onApply} />
        <button
          type="button"
          onClick={() => {
            screen.getByRole("button", { name: "Filters" }).click();
          }}
        >
          Edit filters
        </button>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Edit filters" }));
    expect(document.querySelector("dialog")?.open).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Edit filters" })).toHaveFocus();
  });

  it("adopts filters that change in the URL (back/forward), closing the dialog", async () => {
    const { user, button, dialog, view, onApply } = setup();
    await user.click(button());
    await user.click(radio("Grass"));
    view.rerender(<FiltersControl filters={{ ...defaultFilters(), surface: "hybrid" }} onApply={onApply} />);
    expect(dialog()?.open).toBe(false);
    expect(button()).toHaveAccessibleName("Filters, 1 active");
    await user.click(button());
    expect(radio("Hybrid")).toBeChecked();
  });
});
