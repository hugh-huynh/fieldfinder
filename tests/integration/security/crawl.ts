import postgres from "postgres";

import { GET as getPitchRoute } from "@/app/api/venues/[venueSlug]/pitches/[pitchSlug]/route";
import { GET as getVenueRoute } from "@/app/api/venues/[venueSlug]/route";
import { GET as searchRoute } from "@/app/api/venues/route";
import { MAX_LIMIT, MAX_RADIUS_KM } from "@/features/search/query";

import { LOCAL_ADMIN_URL } from "../../setup/integration-env";

// The security sweep's view of the data (PR 2.15). `loadTruth` reads the base tables with the owner
// connection and applies the publishing rules itself, independently of the public views under test:
//   * a venue is public when it's published and has at least one published pitch;
//   * a pitch is public when it's published and its venue is public;
//   * an image is public when it's published and its owner (venue or pitch) is public.
// `crawlPublicApi` then requests every public data route the way a client (or scraper) would.

export interface Truth {
  venues: { id: string; slug: string; latitude: number; longitude: number; isPublic: boolean }[];
  pitches: { id: string; slug: string; venueSlug: string; isPublic: boolean }[];
  media: { id: string; storageKey: string; publicKey: string | null; isPublic: boolean }[];
}

export async function loadTruth(): Promise<Truth> {
  const sql = postgres(LOCAL_ADMIN_URL, { max: 1, onnotice: () => undefined });
  try {
    const venues = await sql<{ id: string; slug: string; latitude: number; longitude: number; status: string }[]>`
      select id::text, slug, latitude::float8 as latitude, longitude::float8 as longitude, status::text from public.venues
    `;
    const pitches = await sql<{ id: string; slug: string; venue_id: string; status: string }[]>`
      select id::text, slug, venue_id::text, status::text from public.pitches
    `;
    const media = await sql<
      {
        id: string;
        storage_key: string;
        public_key: string | null;
        status: string;
        venue_id: string | null;
        pitch_id: string | null;
      }[]
    >`select id::text, storage_key, public_key, status::text, venue_id::text, pitch_id::text from public.media_assets`;

    const publicVenueIds = new Set(
      venues
        .filter((v) => v.status === "published")
        .filter((v) => pitches.some((p) => p.venue_id === v.id && p.status === "published"))
        .map((v) => v.id),
    );
    const slugOf = new Map(venues.map((v) => [v.id, v.slug]));
    const publicPitchIds = new Set(
      pitches.filter((p) => p.status === "published" && publicVenueIds.has(p.venue_id)).map((p) => p.id),
    );
    return {
      venues: venues.map((v) => ({
        id: v.id,
        slug: v.slug,
        latitude: v.latitude,
        longitude: v.longitude,
        isPublic: publicVenueIds.has(v.id),
      })),
      pitches: pitches.map((p) => ({
        id: p.id,
        slug: p.slug,
        venueSlug: slugOf.get(p.venue_id) ?? "",
        isPublic: publicPitchIds.has(p.id),
      })),
      media: media.map((m) => ({
        id: m.id,
        storageKey: m.storage_key,
        publicKey: m.public_key,
        isPublic:
          m.status === "published" &&
          ((m.venue_id !== null && publicVenueIds.has(m.venue_id)) ||
            (m.pitch_id !== null && publicPitchIds.has(m.pitch_id))),
      })),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export type Endpoint = "search" | "venue" | "pitch";

export interface Exchange {
  endpoint: Endpoint;
  /** What was asked for, for failure messages. */
  target: string;
  status: number;
  text: string;
}

/** Shortest decimal form at 3 dp, as the canonical search URL writes it. */
const coordinate = (value: number) => String(Math.round(value * 1000) / 1000 || 0);

/** Every page of a 50 km search centred on (lat, lng), following the canonical redirect if any. */
async function searchAll(lat: number, lng: number): Promise<Exchange[]> {
  const out: Exchange[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    let query = `lat=${coordinate(lat)}&lng=${coordinate(lng)}&radiusKm=${String(MAX_RADIUS_KM)}&limit=${String(MAX_LIMIT)}`;
    if (cursor !== null) query += `&cursor=${cursor}`;
    let res = await searchRoute(new Request(`https://ff.test/api/venues?${query}`), { params: Promise.resolve({}) });
    if (res.status === 308) {
      const location = res.headers.get("location") ?? "";
      res = await searchRoute(new Request(`https://ff.test${location}`), { params: Promise.resolve({}) });
    }
    const text = await res.text();
    out.push({ endpoint: "search", target: `search ${query}`, status: res.status, text });
    if (res.status !== 200) break;
    cursor = (JSON.parse(text) as { nextCursor: string | null }).nextCursor;
    if (cursor === null) break;
  }
  return out;
}

const detail = new Request("https://ff.test/api/venues/detail");

/** Search from every venue's own location, every venue page and every pitch page (by its venue). */
export async function crawlPublicApi(truth: Truth): Promise<Exchange[]> {
  const exchanges: Exchange[] = [];
  for (const venue of truth.venues) exchanges.push(...(await searchAll(venue.latitude, venue.longitude)));
  for (const venue of truth.venues) {
    const res = await getVenueRoute(detail, { params: Promise.resolve({ venueSlug: venue.slug }) });
    exchanges.push({ endpoint: "venue", target: `venue ${venue.slug}`, status: res.status, text: await res.text() });
  }
  for (const pitch of truth.pitches) {
    const res = await getPitchRoute(detail, {
      params: Promise.resolve({ venueSlug: pitch.venueSlug, pitchSlug: pitch.slug }),
    });
    exchanges.push({
      endpoint: "pitch",
      target: `pitch ${pitch.venueSlug}/${pitch.slug}`,
      status: res.status,
      text: await res.text(),
    });
  }
  return exchanges;
}

/** Every object key in a JSON value, anywhere in it. */
export function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => allKeys(item, into));
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      allKeys(child, into);
    }
  }
  return into;
}

/**
 * Field paths in a JSON value, with array items as `[]` and the keys of a map-like object (amenities)
 * kept, e.g. `items[].image.attribution.licenseUrl`.
 */
export function keyPaths(value: unknown, prefix = "", into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keyPaths(item, `${prefix}[]`, into));
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      into.add(path);
      keyPaths(child, path, into);
    }
  }
  return into;
}
