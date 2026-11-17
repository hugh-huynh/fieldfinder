// "Use my location" as a state machine (spec §3 "Search behavior", ADR-0005, PR 3.9). Pure, so every
// path is unit-tested without a browser; useGeolocation drives it.
//
// - unsupported: no Geolocation API. The button isn't offered.
// - checking: asking the Permissions API whether access is already granted (never prompting).
// - prompt: not decided yet (or the browser won't say). Nothing happens until the person presses
//   "Use my location", which may show the browser's own prompt.
// - granted: allowed. On the landing page with no place chosen, the position is read automatically.
// - locating: reading the position.
// - denied / timeout / unavailable: it didn't work; manual search still does. The button stays, so
//   the person can try again (a denied browser just says no again; the message says where to fix it).

export type GeoStatus =
  "unsupported" | "checking" | "prompt" | "granted" | "locating" | "denied" | "timeout" | "unavailable";

export type GeoEvent =
  | { type: "init"; supported: boolean; permissionsApi: boolean }
  | { type: "permission"; state: PermissionState }
  | { type: "locate" }
  | { type: "located" }
  /** GeolocationPositionError codes: 1 denied, 2 unavailable, 3 timeout. Anything else: unavailable. */
  | { type: "failed"; code: number };

export function geoReducer(status: GeoStatus, event: GeoEvent): GeoStatus {
  switch (event.type) {
    case "init":
      if (!event.supported) return "unsupported";
      return event.permissionsApi ? "checking" : "prompt";
    case "permission":
      // A change while reading the position doesn't interrupt it.
      if (status === "unsupported" || status === "locating") return status;
      return event.state === "granted" ? "granted" : event.state === "denied" ? "denied" : "prompt";
    case "locate":
      return status === "unsupported" ? status : "locating";
    case "located":
      return status === "locating" ? "granted" : status;
    case "failed":
      if (status !== "locating") return status;
      return event.code === 1 ? "denied" : event.code === 3 ? "timeout" : "unavailable";
  }
}

/** What the person is told (politely announced). Empty when there's nothing to say. */
export function geoMessage(status: GeoStatus): string {
  switch (status) {
    case "locating":
      return "Finding your location…";
    case "denied":
      return "Location access is off for this site. Allow it in your browser's settings, or search a place.";
    case "timeout":
      return "Couldn't get your location in time. Try again, or search a place.";
    case "unavailable":
      return "Your location isn't available right now. Try again, or search a place.";
    default:
      return "";
  }
}

/** Options for reading the position: a suburb-level fix is plenty (rounded to ~1 km anyway). */
export const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 5 * 60_000,
};

/** Shown when the position has no named locality (or the lookup failed). */
export const FALLBACK_LABEL = "Your location";
