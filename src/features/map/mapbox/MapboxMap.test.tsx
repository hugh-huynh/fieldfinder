import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type MapAdapterProps, type MapMarker } from "../types";

import { MapboxMap } from "./MapboxMap";

// The Mapbox adapter (PR 3.4) against a stand-in mapbox-gl (jsdom has no WebGL): the options it
// starts with, markers as named buttons in list order, restyling without moving the map, fitting
// only for a new view, zoom, and saying when the map can't be shown.

const gl = vi.hoisted(() => {
  type Handler = () => void;
  class FakeGlMap {
    static throwOnCreate = false;
    static all: FakeGlMap[] = [];
    readonly options: { container: HTMLElement } & Record<string, unknown>;
    readonly handlers = new Map<string, Handler[]>();
    readonly fitBounds = vi.fn();
    readonly zoomIn = vi.fn();
    readonly zoomOut = vi.fn();
    readonly remove = vi.fn();
    readonly touchZoomRotate = { disableRotation: vi.fn() };
    readonly keyboard = { disableRotation: vi.fn() };
    constructor(options: { container: HTMLElement } & Record<string, unknown>) {
      if (FakeGlMap.throwOnCreate) throw new Error("Failed to initialize WebGL");
      this.options = options;
      FakeGlMap.all.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string) {
      for (const handler of this.handlers.get(event) ?? []) handler();
    }
  }
  class FakeGlMarker {
    readonly element: HTMLElement;
    lngLat: [number, number] = [0, 0];
    constructor({ element }: { element: HTMLElement }) {
      this.element = element;
    }
    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }
    addTo(map: FakeGlMap) {
      map.options.container.append(this.element);
      return this;
    }
    remove() {
      this.element.remove();
      return this;
    }
  }
  return { FakeGlMap, FakeGlMarker };
});

vi.mock("mapbox-gl", () => ({ default: { Map: gl.FakeGlMap, Marker: gl.FakeGlMarker } }));

const marker = (n: number, count = 2): MapMarker => ({
  id: `v${String(n)}`,
  position: { lat: -37.8 - n / 100, lng: 144.9 + n / 100 },
  count,
  label: `Venue ${String(n)}, ${String(count)} pitches`,
});

const bounds = { south: -37.9, west: 144.9, north: -37.7, east: 145.1 };

function props(overrides: Partial<MapAdapterProps> = {}): MapAdapterProps & { token: string } {
  return {
    token: "pk.test",
    markers: [marker(1), marker(2, 4)],
    bounds,
    viewKey: "search-1",
    highlightedId: null,
    selectedId: null,
    onMarkerClick: vi.fn(),
    onRecentre: vi.fn(),
    onUnavailable: vi.fn(),
    ...overrides,
  };
}

const glMap = () => {
  const map = gl.FakeGlMap.all.at(-1);
  if (map === undefined) throw new Error("no map created");
  return map;
};
const markerButtons = () =>
  screen.queryAllByRole("button", { name: /pitches/ }).map((b) => [b.getAttribute("aria-label"), b.textContent]);

beforeEach(() => {
  gl.FakeGlMap.throwOnCreate = false;
  gl.FakeGlMap.all = [];
});

describe("MapboxMap", () => {
  it("starts on the search's area with the public token, a 2D map, and Mapbox's attribution left on", () => {
    render(<MapboxMap {...props()} />);
    const { options } = glMap();
    expect(options.accessToken).toBe("pk.test");
    expect(options.bounds).toEqual([
      [144.9, -37.9],
      [145.1, -37.7],
    ]);
    expect(options.dragRotate).toBe(false);
    expect(options.touchPitch).toBe(false);
    expect(options).not.toHaveProperty("attributionControl");
    expect(glMap().touchZoomRotate.disableRotation).toHaveBeenCalled();
  });

  it("adds markers as named buttons in list order, and keeps them in step with the venues", () => {
    const { rerender } = render(<MapboxMap {...props()} />);
    expect(markerButtons()).toEqual([
      ["Venue 1, 2 pitches", "2"],
      ["Venue 2, 4 pitches", "4"],
    ]);

    const first = screen.getByRole("button", { name: "Venue 1, 2 pitches" });
    expect(first).toHaveAttribute("data-marker-id", "v1");
    expect(first).toHaveAttribute("aria-haspopup", "dialog");

    rerender(<MapboxMap {...props({ markers: [marker(2, 4), marker(3)] })} />);
    expect(markerButtons()).toEqual([
      ["Venue 2, 4 pitches", "4"],
      ["Venue 3, 2 pitches", "2"],
    ]);
  });

  it("reports marker clicks by venue id", async () => {
    const p = props();
    render(<MapboxMap {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Venue 2, 4 pitches" }));
    expect(p.onMarkerClick).toHaveBeenCalledWith("v2");
  });

  it("restyles highlighted and chosen markers without moving the map", () => {
    const { rerender } = render(<MapboxMap {...props()} />);
    rerender(<MapboxMap {...props({ highlightedId: "v1", selectedId: "v2" })} />);
    const one = screen.getByRole("button", { name: "Venue 1, 2 pitches" });
    const two = screen.getByRole("button", { name: "Venue 2, 4 pitches" });
    expect(one).toHaveAttribute("data-marker-state", "highlighted");
    expect(two).toHaveAttribute("data-marker-state", "selected");
    expect(two).toHaveAttribute("aria-expanded", "true");
    expect(two.className).toContain("scale-125");
    expect(two.parentElement?.style.zIndex).toBe("2");
    expect(glMap().fitBounds).not.toHaveBeenCalled();
  });

  it("fits the area again only when the view changes", () => {
    const { rerender } = render(<MapboxMap {...props()} />);
    const wider = { ...bounds, north: -37.6 };
    rerender(<MapboxMap {...props({ bounds: wider, markers: [marker(1), marker(2), marker(3)] })} />);
    expect(glMap().fitBounds).not.toHaveBeenCalled();

    rerender(<MapboxMap {...props({ bounds: wider, viewKey: "search-1|recentre" })} />);
    expect(glMap().fitBounds).toHaveBeenCalledTimes(1);
    expect(glMap().fitBounds).toHaveBeenCalledWith(
      [
        [144.9, -37.9],
        [145.1, -37.6],
      ],
      { padding: 48, maxZoom: 15 },
    );
  });

  it("zooms with its buttons and passes Recentre up", async () => {
    const p = props();
    const user = userEvent.setup();
    render(<MapboxMap {...p} />);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Recentre map" }));
    expect(glMap().zoomIn).toHaveBeenCalledTimes(1);
    expect(glMap().zoomOut).toHaveBeenCalledTimes(1);
    expect(p.onRecentre).toHaveBeenCalledTimes(1);
  });

  describe("when the map can't be shown", () => {
    it("says so if the map can't start (no WebGL)", () => {
      gl.FakeGlMap.throwOnCreate = true;
      const p = props();
      render(<MapboxMap {...p} />);
      expect(p.onUnavailable).toHaveBeenCalledTimes(1);
    });

    it("says so if loading fails (bad token, style unreachable), but not for a later error", () => {
      const p = props();
      render(<MapboxMap {...p} />);
      act(() => {
        glMap().emit("error");
      });
      expect(p.onUnavailable).toHaveBeenCalledTimes(1);

      const q = props();
      render(<MapboxMap {...q} />);
      act(() => {
        glMap().emit("load");
        glMap().emit("error");
      });
      expect(q.onUnavailable).not.toHaveBeenCalled();
    });
  });

  it("removes the map when it goes away", () => {
    const { unmount } = render(<MapboxMap {...props()} />);
    const map = glMap();
    unmount();
    expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it("keeps markers inside the map container", () => {
    const { container } = render(<MapboxMap {...props()} />);
    expect(within(container).getAllByRole("button", { name: /pitches/ })).toHaveLength(2);
  });
});
