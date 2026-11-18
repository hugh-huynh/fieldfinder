import { AMENITY_LABELS, FORMAT_LABELS, SURFACE_LABELS } from "@/features/search/format";
import type { PitchDto } from "@/features/pitches/dto";
import type { MediaDto, VenueDetailDto } from "@/features/venues/dto";
import { AMENITY_KEYS, type AccessClass } from "@/lib/domain/enums";

// Structured data for venue and pitch pages (PR 4.2, spec §6): schema.org SportsActivityLocation
// built only from published, confirmed facts, the same ones the page shows. Unknown values are left
// out, never guessed (CLAUDE.md rule 4), and there are no ratings, reviews, prices, offers, opening
// hours or availability: FieldFinder has none of those.

type Thing = Record<string, unknown>;

/** `absolute` turns a site path into an absolute URL (src/lib/site.ts `siteUrl`). */
type Absolute = (path: string) => string;

function address(venue: VenueDetailDto): Thing {
  return {
    "@type": "PostalAddress",
    ...(venue.streetAddress === null ? {} : { streetAddress: venue.streetAddress }),
    addressLocality: venue.suburb,
    addressRegion: venue.state,
    ...(venue.postcode === null ? {} : { postalCode: venue.postcode }),
    addressCountry: "AU",
  };
}

function geo(venue: VenueDetailDto): Thing {
  return { "@type": "GeoCoordinates", latitude: venue.location.latitude, longitude: venue.location.longitude };
}

function feature(name: string, value: boolean): Thing {
  return { "@type": "LocationFeatureSpecification", name, value };
}

/** Confirmed amenities only, yes → true and no → false; unconfirmed ones are absent from the DTO. */
function amenityFeatures(venue: VenueDetailDto): Thing[] {
  return AMENITY_KEYS.flatMap((key) => {
    const state = venue.amenities[key];
    return state === undefined ? [] : [feature(AMENITY_LABELS[key], state === "yes")];
  });
}

/**
 * schema.org `publicAccess`: true for public access, false for members only. "Booking required" is
 * neither (anyone may book) and unknown is unknown, so both leave it out.
 */
function publicAccess(access: AccessClass | null): Thing {
  if (access === "public") return { publicAccess: true };
  if (access === "members_only") return { publicAccess: false };
  return {};
}

function images(media: readonly MediaDto[]): Thing {
  return media.length === 0 ? {} : { image: media.map((item) => item.url) };
}

function optional(key: string, value: unknown[]): Thing {
  return value.length === 0 ? {} : { [key]: value };
}

export function venueJsonLd(
  venue: VenueDetailDto,
  pitches: readonly PitchDto[],
  media: readonly MediaDto[],
  urls: { venue: string; pitch: (pitch: PitchDto) => string },
  absolute: Absolute,
): Thing {
  return {
    "@context": "https://schema.org",
    "@type": "SportsActivityLocation",
    name: venue.name,
    url: absolute(urls.venue),
    ...(venue.description === null ? {} : { description: venue.description }),
    address: address(venue),
    geo: geo(venue),
    ...images(media),
    ...optional("amenityFeature", amenityFeatures(venue)),
    ...publicAccess(venue.access),
    ...optional(
      "containsPlace",
      pitches.map((pitch) => ({
        "@type": "SportsActivityLocation",
        name: pitch.name,
        url: absolute(urls.pitch(pitch)),
      })),
    ),
  };
}

function property(name: string, value: string | number, unitCode?: string): Thing {
  return { "@type": "PropertyValue", name, value, ...(unitCode === undefined ? {} : { unitCode }) };
}

/** The pitch's confirmed specs; dimensions in metres (UN/CEFACT "MTR"). */
function pitchProperties(pitch: PitchDto): Thing[] {
  return [
    ...(pitch.surface === null ? [] : [property("Surface", SURFACE_LABELS[pitch.surface])]),
    ...(pitch.pitchFormat === null ? [] : [property("Pitch size", FORMAT_LABELS[pitch.pitchFormat])]),
    ...(pitch.lengthMeters === null ? [] : [property("Length", pitch.lengthMeters, "MTR")]),
    ...(pitch.widthMeters === null ? [] : [property("Width", pitch.widthMeters, "MTR")]),
  ];
}

export function pitchJsonLd(
  pitch: PitchDto,
  venue: VenueDetailDto,
  media: readonly MediaDto[],
  urls: { pitch: string; venue: string },
  absolute: Absolute,
): Thing {
  const features = [
    ...(pitch.floodlights === null ? [] : [feature("Floodlights", pitch.floodlights)]),
    // The venue's facilities, shown on the pitch page as shared with the venue.
    ...amenityFeatures(venue),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "SportsActivityLocation",
    name: `${pitch.name} at ${venue.name}`,
    url: absolute(urls.pitch),
    address: address(venue),
    geo: geo(venue),
    ...images(media),
    ...optional("amenityFeature", features),
    ...optional("additionalProperty", pitchProperties(pitch)),
    ...publicAccess(pitch.effectiveAccess),
    containedInPlace: { "@type": "SportsActivityLocation", name: venue.name, url: absolute(urls.venue) },
  };
}

/**
 * JSON for a `<script type="application/ld+json">` body. `<`, `>` and `&` are escaped so text from
 * the database (a name, a description) can never close the script element or open a comment.
 */
export function serializeJsonLd(data: Thing): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
