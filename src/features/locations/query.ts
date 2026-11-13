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
