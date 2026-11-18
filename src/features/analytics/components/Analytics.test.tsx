import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_STORAGE_KEY, setConsent } from "../consent";

import { Analytics } from "./Analytics";
import { AnalyticsChoice } from "./AnalyticsChoice";
import { TrackView } from "./TrackView";

// GA4 in the app (PR 4.1): an opt-in banner, nothing loaded without a yes, one page view per page at
// a sanitised location, and the detail-page and directions events.

const ID = "G-TEST12345";
const VENUE = "5eed0000-0000-4000-8000-000000000001";
const PITCH = "5eed0000-0000-4000-8000-000000000002";

const route = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));

function go(path: string) {
  const url = new URL(path, window.location.origin);
  route.pathname = url.pathname;
  route.search = url.search.slice(1);
  window.history.pushState(null, "", path);
}

function layer(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}
const events = () => layer().filter((entry) => entry[0] === "event");
const pageViews = () => events().filter((entry) => entry[1] === "page_view");
const gtagScript = () => document.querySelector("script[data-ff-gtag]");
const banner = () => screen.queryByRole("region", { name: "Help us improve FieldFinder?" });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", ID);
  go("/?lat=-37.784&lng=144.968&place=12+Smith+St%2C+Fitzroy&radiusKm=5");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Analytics", () => {
  it("does nothing at all without a measurement id: no banner, no script", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "");
    render(<Analytics />);
    expect(banner()).toBeNull();
    expect(gtagScript()).toBeNull();
  });

  it("asks first, and loads nothing until the person allows it", async () => {
    render(<Analytics />);
    expect(banner()).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How we handle data" })).toHaveAttribute("href", "/privacy");
    expect(gtagScript()).toBeNull();
    expect(window.dataLayer).toBeUndefined();

    await userEvent.setup().click(screen.getByRole("button", { name: "Allow analytics" }));
    expect(banner()).toBeNull();
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("granted");
    expect(gtagScript()).not.toBeNull();
    // The page being viewed when the person said yes, without its place or coordinates.
    expect(pageViews()).toEqual([
      ["event", "page_view", { page_location: `${window.location.origin}/?radiusKm=5`, page_title: "" }],
    ]);
  });

  it("makes room for itself on screen-sized pages while it's shown (--consent-h)", async () => {
    render(<Analytics />);
    expect(document.documentElement.style.getPropertyValue("--consent-h")).toMatch(/^\d+px$/);
    await userEvent.setup().click(screen.getByRole("button", { name: "No thanks" }));
    expect(document.documentElement.style.getPropertyValue("--consent-h")).toBe("");
  });

  it('loads nothing after "No thanks", and doesn\'t ask again', async () => {
    const { unmount } = render(<Analytics />);
    await userEvent.setup().click(screen.getByRole("button", { name: "No thanks" }));
    expect(banner()).toBeNull();
    expect(gtagScript()).toBeNull();
    expect(events()).toEqual([]);
    unmount();
    render(<Analytics />);
    expect(banner()).toBeNull();
  });

  it("sends one page view per page, not one per render or per new search with the same filters", () => {
    setConsent("granted");
    const { rerender } = render(<Analytics />);
    rerender(<Analytics />);
    // Another place, same filters: the same page (the search events count it).
    go("/?lat=-37.81&lng=144.96&place=Melbourne&radiusKm=5");
    rerender(<Analytics />);
    expect(pageViews()).toHaveLength(1);

    go("/venues/ironbark-park");
    rerender(<Analytics />);
    expect(pageViews()).toHaveLength(2);
    expect(pageViews()[1]?.[2]).toEqual({
      page_location: `${window.location.origin}/venues/ironbark-park`,
      page_referrer: `${window.location.origin}/?radiusKm=5`,
      page_title: "",
    });
    expect(JSON.stringify(layer())).not.toMatch(/lat=|lng=|Smith|Melbourne/);
  });

  it("stops and clears GA's cookies when the choice changes to off", () => {
    setConsent("granted");
    render(<Analytics />);
    document.cookie = "_ga=GA1.1.1; Path=/";
    act(() => {
      setConsent("denied");
    });
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${ID}`]).toBe(true);
    expect(document.cookie).not.toMatch(/_ga=/);
  });

  it("sends click_directions from a marked link, with its pitch when there is one", () => {
    setConsent("granted");
    render(
      <>
        <Analytics />
        <a href="#venue" data-analytics-event="click_directions" data-venue-id={VENUE}>
          Venue directions
        </a>
        <a href="#pitch" data-analytics-event="click_directions" data-venue-id={VENUE} data-pitch-id={PITCH}>
          Pitch directions
        </a>
        <a href="#bad" data-analytics-event="click_directions" data-venue-id="not-an-id">
          Broken directions
        </a>
      </>,
    );
    fireEvent.click(screen.getByText("Venue directions"));
    fireEvent.click(screen.getByText("Pitch directions"));
    fireEvent.click(screen.getByText("Broken directions"));
    expect(
      events()
        .filter((entry) => entry[1] === "click_directions")
        .map((entry) => entry[2]),
    ).toEqual([
      { venue_id: VENUE, page_location: `${window.location.origin}/?radiusKm=5` },
      { venue_id: VENUE, pitch_id: PITCH, page_location: `${window.location.origin}/?radiusKm=5` },
    ]);
  });

  it("sends nothing from marked links without consent", () => {
    render(
      <>
        <Analytics />
        <a href="#venue" data-analytics-event="click_directions" data-venue-id={VENUE}>
          Directions
        </a>
      </>,
    );
    fireEvent.click(screen.getByText("Directions"));
    expect(window.dataLayer).toBeUndefined();
  });
});

describe("TrackView", () => {
  it("sends view_venue once, after the page view, with where it was opened from", () => {
    setConsent("granted");
    const { rerender } = render(
      <>
        <Analytics />
        <a href="#card" data-analytics-source="list">
          Card
        </a>
      </>,
    );
    fireEvent.click(screen.getByText("Card"));
    go("/venues/ironbark-park");
    rerender(
      <>
        <Analytics />
        <TrackView kind="venue" venueId={VENUE} />
      </>,
    );
    rerender(
      <>
        <Analytics />
        <TrackView kind="venue" venueId={VENUE} />
      </>,
    );
    const names = events().map((entry) => entry[1]);
    expect(names).toEqual(["page_view", "page_view", "view_venue"]);
    expect(events().at(-1)?.[2]).toEqual({
      venue_id: VENUE,
      source: "list",
      page_location: `${window.location.origin}/venues/ironbark-park`,
    });
  });

  it("sends view_venue on a hydrated load with consent already given, after the page view", async () => {
    setConsent("granted");
    go("/venues/ironbark-park");
    const page = (
      <>
        <Analytics />
        <TrackView kind="venue" venueId={VENUE} />
      </>
    );
    // Server-rendered first: consent is "pending" while hydrating, so analytics starts a render later.
    const container = document.createElement("div");
    container.innerHTML = renderToString(page);
    document.body.append(container);
    render(page, { container, hydrate: true });
    await waitFor(() => {
      expect(events().map((entry) => entry[1])).toEqual(["page_view", "view_venue"]);
    });
  });

  it("sends no view without consent, and the view once the person allows analytics", async () => {
    go("/venues/ironbark-park");
    render(
      <>
        <Analytics />
        <TrackView kind="venue" venueId={VENUE} />
      </>,
    );
    expect(window.dataLayer).toBeUndefined();
    await userEvent.setup().click(screen.getByRole("button", { name: "Allow analytics" }));
    expect(events().map((entry) => entry[1])).toEqual(["page_view", "view_venue"]);
  });

  it("sends view_pitch as direct when nothing noted where it came from", () => {
    setConsent("granted");
    go("/venues/ironbark-park/pitches/main");
    render(
      <>
        <Analytics />
        <TrackView kind="pitch" venueId={VENUE} pitchId={PITCH} />
      </>,
    );
    expect(events().at(-1)).toEqual([
      "event",
      "view_pitch",
      {
        venue_id: VENUE,
        pitch_id: PITCH,
        source: "direct",
        page_location: `${window.location.origin}/venues/ironbark-park/pitches/main`,
      },
    ]);
  });
});

describe("AnalyticsChoice (/privacy)", () => {
  it("shows the current choice and changes it, announcing the result", async () => {
    const user = userEvent.setup();
    render(<AnalyticsChoice />);
    const group = screen.getByRole("group", { name: "Google Analytics in this browser" });
    expect(group).toHaveAccessibleDescription("You haven’t chosen yet, so analytics is off.");
    expect(screen.getByRole("radio", { name: "Allow analytics" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Don’t allow" })).not.toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Allow analytics" }));
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("granted");
    expect(screen.getByRole("status")).toHaveTextContent("Analytics is on for this browser.");

    await user.click(screen.getByRole("radio", { name: "Don’t allow" }));
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("denied");
    expect(screen.getByRole("status")).toHaveTextContent("Analytics is off for this browser.");
  });

  it("says there's nothing to choose when analytics isn't configured", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "");
    render(<AnalyticsChoice />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/nothing to choose/)).toBeInTheDocument();
  });
});
