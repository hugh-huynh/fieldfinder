import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushSavedView, readSavedView, saveSearchView } from "./history-state";

// Where the person was on a search page, kept in its history entry (PR 3.6). A stand-in window with
// a history that records replaceState calls; Next.js's own keys (__NA etc.) must survive our writes.

const KEY = "fieldfinder:search";
const QUERY = "lat=-37.814&lng=144.963";

let history: { state: unknown; replaceState: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.useFakeTimers();
  history = {
    state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: "tree" },
    replaceState: vi.fn((state: unknown) => {
      history.state = state;
    }),
  };
  vi.stubGlobal("window", { history, location: { href: "http://localhost/?x" } });
});

afterEach(() => {
  flushSavedView();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const stored = () => (history.state as Record<string, unknown>)[KEY];

describe("readSavedView", () => {
  it("returns what was saved for this search", () => {
    history.state = {
      [KEY]: { query: QUERY, scrollY: 640, loaded: 25, bounds: { south: -38, west: 144, north: -37, east: 145 } },
    };
    expect(readSavedView(QUERY)).toEqual({
      query: QUERY,
      scrollY: 640,
      loaded: 25,
      bounds: { south: -38, west: 144, north: -37, east: 145 },
    });
  });

  it("ignores what was saved for a different search, and having no search", () => {
    history.state = { [KEY]: { query: QUERY, scrollY: 640 } };
    expect(readSavedView("lat=-37.7&lng=145")).toBeNull();
    expect(readSavedView(null)).toBeNull();
  });

  it.each([
    ["nothing saved", { __NA: true }],
    ["no state at all", null],
    ["not an object", { [KEY]: "x" }],
    ["upside-down bounds", { [KEY]: { query: QUERY, bounds: { south: -37, west: 144, north: -38, east: 145 } } }],
    ["out-of-range latitude", { [KEY]: { query: QUERY, bounds: { south: -91, west: 144, north: -37, east: 145 } } }],
    ["negative scroll", { [KEY]: { query: QUERY, scrollY: -5 } }],
    ["fractional count", { [KEY]: { query: QUERY, loaded: 2.5 } }],
  ])("ignores %s", (_, state) => {
    history.state = state;
    expect(readSavedView(QUERY)).toBeNull();
  });

  it("returns nothing on the server", () => {
    vi.unstubAllGlobals();
    expect(readSavedView(QUERY)).toBeNull();
  });
});

describe("saveSearchView", () => {
  it("batches writes into one replaceState, merging them and keeping Next.js's keys", () => {
    saveSearchView(QUERY, { scrollY: 100 });
    saveSearchView(QUERY, { scrollY: 200 });
    saveSearchView(QUERY, { loaded: 20 });
    expect(history.replaceState).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith(expect.anything(), "", "http://localhost/?x");
    expect(history.state).toMatchObject({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: "tree" });
    expect(stored()).toEqual({ query: QUERY, scrollY: 200, loaded: 20 });
  });

  it("adds to what this search already saved", () => {
    history.state = { [KEY]: { query: QUERY, loaded: 20, scrollY: 50 } };
    saveSearchView(QUERY, { scrollY: 300 });
    flushSavedView();
    expect(stored()).toEqual({ query: QUERY, loaded: 20, scrollY: 300 });
  });

  it("replaces what another search saved", () => {
    history.state = { [KEY]: { query: "lat=1&lng=1", loaded: 20, scrollY: 50 } };
    saveSearchView(QUERY, { scrollY: 300 });
    flushSavedView();
    expect(stored()).toEqual({ query: QUERY, scrollY: 300 });
  });

  it("writes straight away when flushed (the page is about to leave this entry)", () => {
    saveSearchView(QUERY, { scrollY: 120 });
    flushSavedView();
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
  });

  it("drops a pending write if the person went to another history entry before it was written", () => {
    saveSearchView(QUERY, { scrollY: 120 });
    // Browser Back/Forward within the batching window: the destination keeps its own saved view.
    const destination = { [KEY]: { query: "lat=1&lng=1", loaded: 20, scrollY: 50 } };
    history.state = destination;
    (window.location as { href: string }).href = "http://localhost/?y";
    vi.advanceTimersByTime(300);
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(history.state).toBe(destination);
  });

  it("doesn't merge a write from one history entry into the next entry's", () => {
    saveSearchView(QUERY, { scrollY: 120, loaded: 30 });
    (window.location as { href: string }).href = "http://localhost/?y";
    saveSearchView(QUERY, { scrollY: 40 });
    flushSavedView();
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith(expect.anything(), "", "http://localhost/?y");
    expect(stored()).toEqual({ query: QUERY, scrollY: 40 });
  });

  it("shrugs off a browser that refuses the write", () => {
    history.replaceState.mockImplementation(() => {
      throw new Error("SecurityError: too many calls");
    });
    saveSearchView(QUERY, { scrollY: 120 });
    expect(() => {
      flushSavedView();
    }).not.toThrow();
  });
});
