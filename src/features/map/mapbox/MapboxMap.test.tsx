import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type MapAdapterProps, type MapMarker } from "../types";

import { MapboxMap } from "./MapboxMap";

// The Mapbox adapter (PR 3.4) against a stand-in mapbox-gl (jsdom has no WebGL): the options it
// starts with, markers as named buttons in list order, restyling without moving the map, fitting
// only for a new view, zoom, and saying when the map can't be shown.

const gl = vi.hoisted(() => {
  type Handler = (payload?: unknown) => void;
  class FakeGlMap {
    static throwOnCreate = false;
    static all: FakeGlMap[] = [];
    readonly options: { container: HTMLElement } & Record<string, unknown>;
    readonly handlers = new Map<string, Handler[]>();
    readonly fitBounds = vi.fn();
    readonly panBy = vi.fn();
    readonly getContainer = vi.fn(() => ({ clientHeight: 600 }));
    /** Screen position the stand-in reports for any point (set per test). */
    projected = { x: 100, y: 300 };
    readonly project = vi.fn(() => this.projected);
    readonly getBounds = vi.fn(() => ({
      getSouth: () => -37.9,
      getWest: () => 144.8,
      getNorth: () => -37.7,
      getEast: () => 145.2,
    }));
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
    emit(event: string, payload?: unknown) {
      for (const handler of this.handlers.get(event) ?? []) handler(payload ?? {});
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
    fit: "padded",
    onViewportChange: vi.fn(),
    obscured: { top: 0, bottom: 0, left: 0, right: 0 },
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
      { padding: { top: 48, bottom: 48, left: 48, right: 48 }, maxZoom: 15 },
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

  describe("viewport (3.6)", () => {
    it("reports each settled move, as the person's only for input events and the zoom buttons", async () => {
      const p = props();
      const user = userEvent.setup();
      render(<MapboxMap {...p} />);
      const viewport = { south: -37.9, west: 144.8, north: -37.7, east: 145.2 };

      act(() => {
        glMap().emit("moveend", {});
      });
      expect(p.onViewportChange).toHaveBeenLastCalledWith(viewport, false);

      act(() => {
        glMap().emit("moveend", { originalEvent: new MouseEvent("mouseup") });
      });
      expect(p.onViewportChange).toHaveBeenLastCalledWith(viewport, true);

      await user.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(glMap().zoomIn).toHaveBeenCalledWith(undefined, { byUser: true });
      act(() => {
        glMap().emit("moveend", { byUser: true });
      });
      expect(p.onViewportChange).toHaveBeenLastCalledWith(viewport, true);
    });

    it("shows a restored viewport exactly, with no padding or animation", () => {
      const { rerender } = render(<MapboxMap {...props({ fit: "exact" })} />);
      expect(glMap().options.fitBoundsOptions).toEqual({ padding: 0, duration: 0 });
      rerender(<MapboxMap {...props({ fit: "exact", viewKey: "search-1|ready" })} />);
      expect(glMap().fitBounds).toHaveBeenLastCalledWith(expect.anything(), { padding: 0, duration: 0 });
    });

    it("pans a chosen marker out from under the preview, and leaves one already clear alone", () => {
      const { rerender } = render(<MapboxMap {...props()} />);
      glMap().projected = { x: 100, y: 60 };
      rerender(<MapboxMap {...props({ selectedId: "v1", obscured: { top: 128, bottom: 0, left: 0, right: 0 } })} />);
      // 60 px down, needs to be 128 + 48 = 176: move the content 116 px down.
      expect(glMap().panBy).toHaveBeenCalledWith([0, -116]);

      glMap().panBy.mockClear();
      glMap().projected = { x: 100, y: 400 };
      rerender(<MapboxMap {...props({ selectedId: "v2", obscured: { top: 128, bottom: 0, left: 0, right: 0 } })} />);
      expect(glMap().panBy).not.toHaveBeenCalled();
    });
  });
});
