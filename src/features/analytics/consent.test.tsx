import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONSENT_STORAGE_KEY, getConsent, setConsent, useConsent } from "./consent";
import { noteSource, takeSource } from "./source";

// Opt-in consent (PR 4.1): no choice means no analytics; the choice is kept in this browser and
// shared with its other tabs; blocked storage falls back to this page.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consent", () => {
  it("is unset until the person chooses, then remembered", () => {
    expect(getConsent()).toBe("unset");
    setConsent("granted");
    expect(getConsent()).toBe("granted");
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("granted");
    setConsent("denied");
    expect(getConsent()).toBe("denied");
  });

  it("ignores anything else found in storage", () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "yes please");
    expect(getConsent()).toBe("unset");
  });

  it("keeps the choice for this page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getConsent()).toBe("unset");
    setConsent("granted");
    expect(getConsent()).toBe("granted");
  });

  it("updates every reader at once, including after another tab's change", () => {
    const { result } = renderHook(() => useConsent());
    expect(result.current).toBe("unset");
    act(() => {
      setConsent("granted");
    });
    expect(result.current).toBe("granted");

    act(() => {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, "denied");
      window.dispatchEvent(new StorageEvent("storage", { key: CONSENT_STORAGE_KEY }));
    });
    expect(result.current).toBe("denied");
  });
});

describe("interaction source", () => {
  it("is used once, then the next view is direct", () => {
    noteSource("list", 1_000);
    expect(takeSource(2_000)).toBe("list");
    expect(takeSource(2_000)).toBe("direct");
  });

  it("goes stale (the link may have opened another tab)", () => {
    noteSource("map", 1_000);
    expect(takeSource(60_000)).toBe("direct");
  });

  it("ignores values that aren't sources", () => {
    noteSource("email", 1_000);
    expect(takeSource(1_000)).toBe("direct");
    noteSource(undefined, 1_000);
    expect(takeSource(1_000)).toBe("direct");
  });
});
