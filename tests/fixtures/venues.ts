import { fixtureId, makeMedia, makePitch, makeVenue, publishedOwnedMedia } from "./factory.ts";
import type { FixtureSet } from "./types.ts";

// Synthetic Melbourne-area dataset (M2 PR 2.5). Names are invented; coordinates are rough suburb
// points used only for distance behaviour. Nothing here describes a real venue's facilities.
// `supabase/seed.sql` is generated from this file: edit here, then run `pnpm seed:generate`.

/**
 * Marker placed in every private or unpublished value (draft names, internal notes, evidence,
 * private storage keys). Security tests assert it never appears in public HTML, API JSON or logs.
 */
export const PRIVATE_SENTINEL = "ff-private-sentinel";

/** Search origin used by tests: Melbourne CBD. */
export const ORIGIN = { latitude: -37.8136, longitude: 144.9631 } as const;

export const fixtures: FixtureSet = {
  venues: [
    // 1 — single published pitch → search routes to the pitch page. Full attributes, mixed amenities,
    //     published venue + pitch images and one draft image that must stay hidden.
    makeVenue(1, {
      slug: "wattlebird-reserve",
      name: "Wattlebird Reserve",
      streetAddress: "1 Example Parade",
      suburb: "Carlton North",
      postcode: "3054",
      latitude: -37.784,
      longitude: 144.972,
      description: "Synthetic fixture venue with one floodlit synthetic pitch.",
      access: "public",
      amenities: { toilets: "yes", parking: "yes", drinking_water: "unknown", cafe: "no" },
      pitches: [
        makePitch(1, {
          slug: "main-pitch",
          name: "Main Pitch",
          surface: "synthetic",
          pitchFormat: "full",
          lengthM: 105,
          widthM: 68,
          floodlights: true,
          media: [publishedOwnedMedia(3, "Floodlit synthetic pitch at night")],
        }),
      ],
      media: [
        publishedOwnedMedia(1, "Entrance gates and car park", 0),
        makeMedia(2, {
          altText: `Unpublished image ${PRIVATE_SENTINEL}`,
          storageKey: `private/${PRIVATE_SENTINEL}/2.webp`,
          displayOrder: 1,
        }),
      ],
    }),

    // 2 — many published pitches with split attributes: no single pitch is synthetic AND lit, so
    //     `surface=synthetic&lighting=yes` must exclude this venue. CC BY image needs attribution.
    makeVenue(2, {
      slug: "ironbark-park",
      name: "Ironbark Park",
      streetAddress: "20 Sample Street",
      suburb: "Fitzroy North",
      postcode: "3068",
      latitude: -37.781,
      longitude: 144.986,
      access: "public",
      amenities: { toilets: "yes", changing_rooms: "yes", cafe: "no", parking: "unknown" },
      pitches: [
        makePitch(2, {
          slug: "pitch-a",
          name: "Pitch A",
          surface: "synthetic",
          pitchFormat: "full",
          floodlights: false,
        }),
        makePitch(3, { slug: "pitch-b", name: "Pitch B", surface: "grass", pitchFormat: "full", floodlights: true }),
        makePitch(4, {
          slug: "pitch-c",
          name: "Pitch C",
          surface: "hybrid",
          pitchFormat: "small_sided",
          floodlights: true,
          access: "members_only",
        }),
      ],
      media: [
        publishedOwnedMedia(4, "Three pitches seen from the pavilion", 0),
        makeMedia(5, {
          altText: "Goalmouth in afternoon light",
          displayOrder: 1,
          status: "published",
          publicKey: `fixtures/public/${fixtureId("media", 5)}.webp`,
          rightsBasis: "cc_by",
          author: "Example Photographer",
          sourceUrl: "https://example.org/photos/goalmouth",
          licenseName: "CC BY 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          attributionText: "Photo: Example Photographer, CC BY 4.0",
          evidenceRef: `evidence/${PRIVATE_SENTINEL}/cc-by-5`,
          commercialUseOk: true,
        }),
      ],
    }),

    // 3 — one published pitch plus a draft pitch at a published venue; the draft must stay hidden and
    //     the venue still routes to its single published pitch. Apostrophe exercises SQL escaping.
    makeVenue(3, {
      slug: "banksias-corner-reserve",
      name: "Banksia's Corner Reserve",
      suburb: "Brunswick",
      postcode: "3056",
      latitude: -37.768,
      longitude: 144.96,
      access: "public",
      amenities: { toilets: "no", public_transport: "yes" },
      pitches: [
        makePitch(5, {
          slug: "north-pitch",
          name: "North Pitch",
          surface: "grass",
          pitchFormat: "small_sided",
          floodlights: false,
        }),
        makePitch(6, {
          slug: "draft-pitch",
          name: `Draft Pitch ${PRIVATE_SENTINEL}`,
          surface: "synthetic",
          status: "draft",
        }),
      ],
    }),

    // 4 — published venue whose pitches are all draft → absent from public views and search.
    makeVenue(4, {
      slug: "lilly-pilly-fields",
      name: `Lilly Pilly Fields ${PRIVATE_SENTINEL}`,
      suburb: "Northcote",
      latitude: -37.77,
      longitude: 145.0,
      access: "public",
      pitches: [makePitch(7, { slug: "pitch-1", name: "Pitch 1", surface: "grass", status: "draft" })],
    }),

    // 5 — draft venue with a published pitch → absent everywhere public.
    makeVenue(5, {
      slug: "hidden-draft-park",
      name: `Hidden Draft Park ${PRIVATE_SENTINEL}`,
      suburb: "Richmond",
      latitude: -37.823,
      longitude: 144.998,
      access: "public",
      status: "draft",
      pitches: [makePitch(8, { slug: "pitch-1", name: "Pitch 1", surface: "synthetic", floodlights: true })],
      media: [makeMedia(6, { altText: "Draft venue image", storageKey: `private/${PRIVATE_SENTINEL}/6.webp` })],
    }),

    // 6 — archived venue with a published pitch → absent everywhere public.
    makeVenue(6, {
      slug: "old-mill-oval",
      name: `Old Mill Oval ${PRIVATE_SENTINEL}`,
      suburb: "Collingwood",
      latitude: -37.802,
      longitude: 144.988,
      access: "public",
      status: "archived",
      pitches: [makePitch(9, { slug: "pitch-1", name: "Pitch 1", surface: "grass" })],
    }),

    // 7 — mixed unknowns: venue access NULL, no amenity rows, a pitch with every attribute NULL and no
    //     images at all (missing-image placeholder). Must never match any filter value.
    makeVenue(7, {
      slug: "paperbark-common",
      name: "Paperbark Common",
      suburb: "Parkville",
      latitude: -37.79,
      longitude: 144.951,
      pitches: [makePitch(10, { slug: "open-field", name: "Open Field" })],
    }),

    // 8 — access inheritance (D11): pitch 1 inherits booking_required from the venue, pitch 2 overrides
    //     to members_only.
    makeVenue(8, {
      slug: "kurrajong-recreation-ground",
      name: "Kurrajong Recreation Ground",
      suburb: "South Yarra",
      postcode: "3141",
      latitude: -37.838,
      longitude: 144.992,
      access: "booking_required",
      amenities: { parking: "yes", changing_rooms: "unknown" },
      pitches: [
        makePitch(11, { slug: "oval-1", name: "Oval 1", surface: "grass", pitchFormat: "full", floodlights: true }),
        makePitch(12, {
          slug: "oval-2",
          name: "Oval 2",
          surface: "grass",
          pitchFormat: "training",
          floodlights: false,
          access: "members_only",
        }),
      ],
    }),

    // 9–10 — ordinary venues inside the default 10 km radius. Saltbush also has an archived pitch that
    //       must never appear on its venue page or at its own URL.
    makeVenue(9, {
      slug: "saltbush-sports-park",
      name: "Saltbush Sports Park",
      suburb: "Footscray",
      postcode: "3011",
      latitude: -37.8,
      longitude: 144.9,
      access: "public",
      amenities: { parking: "yes", toilets: "yes", drinking_water: "yes" },
      pitches: [
        makePitch(13, {
          slug: "east-pitch",
          name: "East Pitch",
          surface: "synthetic",
          pitchFormat: "small_sided",
          floodlights: true,
        }),
        makePitch(14, {
          slug: "west-pitch",
          name: "West Pitch",
          surface: "grass",
          pitchFormat: "full",
          floodlights: false,
        }),
        makePitch(20, {
          slug: "old-pitch",
          name: `Old Pitch ${PRIVATE_SENTINEL}`,
          surface: "grass",
          status: "archived",
        }),
      ],
      media: [publishedOwnedMedia(7, "Two pitches beside the river path")],
    }),
    makeVenue(10, {
      slug: "coastal-heath-reserve",
      name: "Coastal Heath Reserve",
      suburb: "Elwood",
      postcode: "3184",
      latitude: -37.882,
      longitude: 144.985,
      access: "public",
      amenities: { toilets: "yes", cafe: "yes" },
      pitches: [makePitch(15, { slug: "beach-pitch", name: "Beach Pitch", surface: "grass", pitchFormat: "full" })],
    }),

    // 11–13 — outside the default 10 km but inside the 50 km maximum (radius behaviour).
    makeVenue(11, {
      slug: "red-gum-flats",
      name: "Red Gum Flats",
      suburb: "Box Hill",
      latitude: -37.819,
      longitude: 145.122,
      access: "public",
      pitches: [
        makePitch(16, {
          slug: "pitch-1",
          name: "Pitch 1",
          surface: "synthetic",
          pitchFormat: "full",
          floodlights: true,
        }),
      ],
    }),
    makeVenue(12, {
      slug: "grey-box-fields",
      name: "Grey Box Fields",
      suburb: "Ringwood",
      latitude: -37.815,
      longitude: 145.229,
      access: "public",
      pitches: [makePitch(17, { slug: "pitch-1", name: "Pitch 1", surface: "grass", pitchFormat: "full" })],
    }),
    makeVenue(13, {
      slug: "tea-tree-point",
      name: "Tea Tree Point",
      suburb: "Frankston",
      latitude: -38.144,
      longitude: 145.126,
      access: "public",
      pitches: [
        makePitch(18, { slug: "pitch-1", name: "Pitch 1", surface: "hybrid", pitchFormat: "full", floodlights: true }),
      ],
    }),

    // 14 — published but beyond the 50 km maximum radius from the CBD; visible on its own pages only.
    makeVenue(14, {
      slug: "far-plains-oval",
      name: "Far Plains Oval",
      suburb: "Geelong",
      latitude: -38.149,
      longitude: 144.36,
      access: "public",
      pitches: [makePitch(19, { slug: "pitch-1", name: "Pitch 1", surface: "grass", pitchFormat: "full" })],
    }),
  ],

  sources: [
    {
      id: fixtureId("source", 1),
      title: "Synthetic site visit log",
      kind: "site_visit",
      methodology: `Walked each fixture venue (fictional) ${PRIVATE_SENTINEL}`,
      reference: `internal/${PRIVATE_SENTINEL}/visits`,
      rightsNote: "Own observations",
      collectedOn: "2026-09-01",
    },
  ],

  verifications: [
    {
      id: fixtureId("verification", 1),
      venueId: fixtureId("venue", 1),
      pitchId: null,
      sourceId: fixtureId("source", 1),
      verifiedBy: "fixture-operator",
      verifiedOn: "2026-09-01",
      evidence: `Photo set ${PRIVATE_SENTINEL}`,
      confidence: "high",
      internalNotes: `Internal note ${PRIVATE_SENTINEL}`,
    },
  ],
};
