import { z } from "zod";

// The location-suggestion contract shared by the server proxy (./suggest.ts, server-only) and the
// search box (PR 3.2). The search box only asks for queries this schema accepts, so it never spends
// a request (or the 30/min/IP Firewall budget) on one the API would 400.

/** Letters (any script), digits, spaces and the punctuation real place names and addresses use. */
const QUERY = /^[\p{L}\p{M}\p{N} ,.'’\-/&#()]+$/u;

export const suggestQuerySchema = z
  .object({
    q: z
      .string()
      .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
      .pipe(z.string().min(2).max(80).regex(QUERY)),
  })
  .strict();

export interface LocationSuggestionDto {
  /** Mapbox's id for the place. */
  id: string;
  /** Short name, e.g. "Brunswick". */
  name: string;
  /** Full label for the list, e.g. "Brunswick, Victoria 3056, Australia". */
  label: string;
  type: "postcode" | "place" | "locality" | "neighborhood" | "address";
  /** Rounded to 3 dp; pass straight to GET /api/venues. */
  latitude: number;
  longitude: number;
}

export interface SuggestResponse {
  suggestions: LocationSuggestionDto[];
}

/** The query the API would use for `input`, or null when it would reject it (so don't ask). */
export function suggestQuery(input: string): string | null {
  const result = suggestQuerySchema.safeParse({ q: input });
  return result.success ? result.data.q : null;
}

// --- Reverse geocoding for "Use my location" (PR 3.9) -------------------------------------------
// The device's position, already rounded to 2 dp (~1.1 km) on the client (ADR-0005), becomes a
// readable locality for the search box. The server rounds again before anything leaves it.

/** Decimal places a device position is rounded to before it leaves the browser (ADR-0005). */
export const DEVICE_DECIMALS = 2;

const coordinate = (min: number, max: number) =>
  z
    .string()
    .regex(/^-?\d{1,3}(\.\d{1,6})?$/)
    .transform(Number)
    .pipe(z.number().min(min).max(max));

export const reverseQuerySchema = z.object({ lat: coordinate(-90, 90), lng: coordinate(-180, 180) }).strict();

export interface ReversePlaceDto {
  /** Short name, e.g. "Carlton". */
  name: string;
  /** e.g. "Carlton, Victoria 3053, Australia". */
  label: string;
}

export interface ReverseResponse {
  /** Null when there's no locality there (e.g. outside Australia, or at sea). */
  place: ReversePlaceDto | null;
}

const roundDevice = (value: number) => Math.round(value * 10 ** DEVICE_DECIMALS) / 10 ** DEVICE_DECIMALS || 0;

/** The query string for GET /api/locations/reverse: coordinates rounded to 2 dp. */
export function reverseQuery(lat: number, lng: number): string {
  return new URLSearchParams({
    lat: roundDevice(lat).toFixed(DEVICE_DECIMALS),
    lng: roundDevice(lng).toFixed(DEVICE_DECIMALS),
  }).toString();
}

/** "Brunswick, Victoria 3056, Australia" → "Brunswick, Victoria 3056": every place here is in Australia. */
export function withoutCountry(label: string): string {
  return label.replace(/,\s*Australia$/, "");
}
