import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../../../../tests/msw/server";
import { setDeviceFix } from "../device-fix";

import { resetAutoFillForTests, UseMyLocation } from "./UseMyLocation";

// "Use my location" (PR 3.9) with the browser's Geolocation and Permissions APIs stubbed. The
// position here is precise; only its 2 dp rounding may reach the reverse lookup and the URL.

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const PRECISE = { latitude: -37.801234, longitude: 144.966789 };

let reverseAsked: string[] = [];

function stubBrowser({
  permission = "prompt",
  permissionsApi = true,
  supported = true,
  outcome = { position: PRECISE },
}: {
  permission?: PermissionState;
  permissionsApi?: boolean;
  supported?: boolean;
  outcome?: { position: { latitude: number; longitude: number } } | { errorCode: number };
} = {}) {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
    if ("position" in outcome) ok({ coords: outcome.position } as GeolocationPosition);
    else fail?.({ code: outcome.errorCode } as GeolocationPositionError);
  });
  // A plain object standing in for navigator: only what the component may touch.
  const navigatorStub: Record<string, unknown> = { userAgent: globalThis.navigator.userAgent };
  if (supported) navigatorStub.geolocation = { getCurrentPosition };
  if (permissionsApi) {
    navigatorStub.permissions = { query: vi.fn(() => Promise.resolve({ state: permission, onchange: null })) };
  }
  vi.stubGlobal("navigator", navigatorStub);
  return { getCurrentPosition };
}

beforeEach(() => {
  resetAutoFillForTests();
  setDeviceFix(null);
  reverseAsked = [];
  window.history.replaceState(null, "", "/");
  server.use(
    http.get("*/api/locations/reverse", ({ request }) => {
      reverseAsked.push(new URL(request.url).search.slice(1));
      return HttpResponse.json({ place: { name: "Carlton", label: "Carlton, Victoria 3053, Australia" } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const button = () => screen.getByRole("button", { name: "Use my location" });

describe("UseMyLocation", () => {
  it("never reads the position on load when access isn't granted yet (no prompt)", async () => {
    const { getCurrentPosition } = stubBrowser({ permission: "prompt" });
    render(<UseMyLocation autoFill />);
    await waitFor(() => {
      expect(button()).toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("on press: looks up the locality with the rounded position and searches there", async () => {
    const { getCurrentPosition } = stubBrowser({ permission: "prompt" });
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?surface=grass");
    render(<UseMyLocation />);
    await user.click(button());
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledTimes(1);
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(reverseAsked).toEqual(["lat=-37.80&lng=144.97"]);
    const url = new URL(String(router.push.mock.calls[0]?.[0]), "http://x");
    expect(url.searchParams.get("lat")).toBe("-37.8");
    expect(url.searchParams.get("lng")).toBe("144.97");
    expect(url.searchParams.get("place")).toBe("Carlton, Victoria 3053");
    // The current filters are kept.
    expect(url.searchParams.get("surface")).toBe("grass");
    // The precise position never goes anywhere.
    expect(String(router.push.mock.calls[0]?.[0])).not.toMatch(/801234|966789/);
  });

  it("fills in the place automatically when access is already granted and nothing is chosen", async () => {
    stubBrowser({ permission: "granted" });
    render(<UseMyLocation autoFill />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    expect(String(router.replace.mock.calls[0]?.[0])).toContain("place=Carlton");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("only once per page load", async () => {
    const { getCurrentPosition } = stubBrowser({ permission: "granted" });
    const first = render(<UseMyLocation autoFill />);
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledTimes(1);
    });
    first.unmount();
    render(<UseMyLocation autoFill />);
    await new Promise((r) => setTimeout(r, 50));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("never replaces a place the person already chose", async () => {
    const { getCurrentPosition } = stubBrowser({ permission: "granted" });
    window.history.replaceState(null, "", "/?lat=-37.767&lng=144.962&place=Brunswick");
    render(<UseMyLocation autoFill />);
    await new Promise((r) => setTimeout(r, 50));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("never replaces a place the person started typing while it was locating", async () => {
    stubBrowser({ permission: "granted" });
    // The lookup is slow; the person types meanwhile.
    server.use(
      http.get("*/api/locations/reverse", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ place: null });
      }),
    );
    render(
      <>
        <div role="search">
          <input role="combobox" aria-controls="x" aria-expanded="false" aria-label="Search" defaultValue="" />
        </div>
        <UseMyLocation autoFill />
      </>,
    );
    screen.getByRole<HTMLInputElement>("combobox").value = "Bruns";
    await new Promise((r) => setTimeout(r, 150));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("isn't automatic where it isn't asked to be (above the results)", async () => {
    const { getCurrentPosition } = stubBrowser({ permission: "granted" });
    render(<UseMyLocation compact />);
    await new Promise((r) => setTimeout(r, 50));
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("without a Permissions API it waits for the press", async () => {
    const { getCurrentPosition } = stubBrowser({ permissionsApi: false });
    render(<UseMyLocation autoFill />);
    await new Promise((r) => setTimeout(r, 50));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(button()).toBeInTheDocument();
  });

  it.each([
    [1, /Location access is off/],
    [3, /in time/],
    [2, /isn't available/],
  ])("explains a failure (code %i) and keeps manual search on offer", async (errorCode, message) => {
    stubBrowser({ outcome: { errorCode } });
    const user = userEvent.setup();
    render(<UseMyLocation />);
    await user.click(button());
    expect(await screen.findByRole("status")).toHaveTextContent(message);
    expect(screen.getByRole("status")).toHaveTextContent(/search a place/);
    expect(button()).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("says nothing and offers nothing without the Geolocation API", async () => {
    stubBrowser({ supported: false });
    render(<UseMyLocation autoFill />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Use my location" })).toBeNull();
    });
  });

  it("drops a pending press if the person picks another place meanwhile", async () => {
    stubBrowser();
    // The lookup is slow; the person picks Brunswick meanwhile.
    server.use(
      http.get("*/api/locations/reverse", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ place: null });
      }),
    );
    window.history.replaceState(null, "", "/?lat=-37.8136&lng=144.9631&place=Melbourne");
    const user = userEvent.setup();
    render(<UseMyLocation compact />);
    await user.click(button());
    window.history.pushState(null, "", "/?lat=-37.767&lng=144.962&place=Brunswick");
    await new Promise((r) => setTimeout(r, 150));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a newer press supersedes a pending one: only the latest searches", async () => {
    const pending: PositionCallback[] = [];
    vi.stubGlobal("navigator", {
      userAgent: globalThis.navigator.userAgent,
      geolocation: {
        getCurrentPosition: vi.fn((ok: PositionCallback) => {
          pending.push(ok);
        }),
      },
    });
    const user = userEvent.setup();
    render(<UseMyLocation compact />);
    await user.click(button());
    await user.click(button());
    expect(pending).toHaveLength(2);
    // The second answers first; the first answers late, from somewhere else.
    pending[1]?.({ coords: PRECISE } as GeolocationPosition);
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledTimes(1);
    });
    pending[0]?.({ coords: { latitude: -37.9, longitude: 145.1 } } as GeolocationPosition);
    await new Promise((r) => setTimeout(r, 50));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(String(router.push.mock.calls[0]?.[0])).toContain("lat=-37.8");
  });

  it("still searches there if the locality lookup fails, called 'Your location'", async () => {
    stubBrowser();
    server.use(http.get("*/api/locations/reverse", () => new HttpResponse(null, { status: 503 })));
    const user = userEvent.setup();
    render(<UseMyLocation />);
    await user.click(button());
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledTimes(1);
    });
    expect(new URL(String(router.push.mock.calls[0]?.[0]), "http://x").searchParams.get("place")).toBe("Your location");
  });
});
