import type { AmenitiesDto, PitchSummaryDto } from "@/features/venues/dto";
import { AMENITY_KEYS, type AccessClass, type AmenityKey, type PitchFormat, type Surface } from "@/lib/domain/enums";

// Wording for venue cards (PR 3.3). Only confirmed facts are worded: an unconfirmed attribute has no
// label here, so it is left off the card rather than shown as "no" (CLAUDE.md rule 4).

export const SURFACE_LABELS: Record<Surface, string> = { grass: "Grass", synthetic: "Synthetic", hybrid: "Hybrid" };
export const FORMAT_LABELS: Record<PitchFormat, string> = {
  full: "Full size",
  small_sided: "Small-sided",
  training: "Training",
};
export const ACCESS_LABELS: Record<AccessClass, string> = {
  public: "Public access",
  booking_required: "Booking required",
  members_only: "Members only",
};
export const AMENITY_LABELS: Record<AmenityKey, string> = {
  parking: "Parking",
  toilets: "Toilets",
  changing_rooms: "Changing rooms",
  drinking_water: "Drinking water",
  cafe: "Café",
  public_transport: "Public transport",
};

/** "850 m" under 1 km, else "2.1 km" (one decimal), "12 km" from 10 km. */
export function formatDistance(meters: number): string {
  const tens = Math.max(0, Math.round(meters / 10) * 10);
  if (tens < 1000) return `${String(tens)} m`;
  const km = Number((meters / 1000).toFixed(1));
  return km < 10 ? `${km.toFixed(1)} km` : `${String(Math.round(meters / 1000))} km`;
}

/** "1 pitch", "4 pitches", or "2 of 4 pitches match" when the filters rule some out. */
export function pitchCountLabel(published: number, matching: number): string {
  const noun = published === 1 ? "pitch" : "pitches";
  if (matching < published) return `${String(matching)} of ${String(published)} ${noun} match`;
  return `${String(published)} ${noun}`;
}

/** Card labels for the venue's confirmed pitch characteristics, e.g. ["Grass + synthetic", "Full size", "Floodlights"]. */
export function pitchSummaryLabels(summary: PitchSummaryDto): string[] {
  const labels: string[] = [];
  const [first, ...rest] = summary.surfaces.map((s) => SURFACE_LABELS[s]);
  if (first !== undefined) labels.push([first, ...rest.map((label) => label.toLowerCase())].join(" + "));
  if (summary.formats.length > 0) labels.push(summary.formats.map((f) => FORMAT_LABELS[f]).join(" · "));
  if (summary.floodlights === true) labels.push("Floodlights");
  return labels;
}

/** Facilities confirmed as available ("yes"), in AMENITY_KEYS order. "no" and unconfirmed are left out. */
export function availableAmenities(amenities: AmenitiesDto): AmenityKey[] {
  return AMENITY_KEYS.filter((key) => amenities[key] === "yes");
}

/** A photo's credit line (ADR-0006): "Photo: …", without doubling a "Photo:" the credit already has. */
export function creditLine(text: string): string {
  return /^photo\b/i.test(text.trim()) ? text.trim() : `Photo: ${text.trim()}`;
}
