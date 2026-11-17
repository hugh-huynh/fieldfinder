import type { PitchDto } from "@/features/pitches/dto";
import { ACCESS_LABELS, FORMAT_LABELS, SURFACE_LABELS } from "@/features/search/format";

// A pitch's specs table on its page (spec §3 details, PR 3.11): every spec, each one either its
// confirmed value or "Not confirmed". Nothing is guessed (CLAUDE.md rule 4). Access says where the
// rule comes from: the pitch's own, or the venue's that it follows (D11).

export const NOT_CONFIRMED = "Not confirmed";

export interface SpecRow {
  label: string;
  value: string;
  /** A short note beside the value, e.g. where an access rule comes from. */
  note?: string;
}

export function pitchSpecs(pitch: PitchDto): SpecRow[] {
  const size =
    pitch.lengthMeters !== null && pitch.widthMeters !== null
      ? `${String(pitch.lengthMeters)} × ${String(pitch.widthMeters)} m`
      : pitch.lengthMeters !== null
        ? `${String(pitch.lengthMeters)} m long (width not confirmed)`
        : pitch.widthMeters !== null
          ? `${String(pitch.widthMeters)} m wide (length not confirmed)`
          : NOT_CONFIRMED;

  const access: SpecRow =
    pitch.effectiveAccess === null
      ? { label: "Access", value: NOT_CONFIRMED }
      : {
          label: "Access",
          value: ACCESS_LABELS[pitch.effectiveAccess],
          note: pitch.access === null ? "the venue's rule" : "this pitch's own rule",
        };

  return [
    { label: "Surface", value: pitch.surface === null ? NOT_CONFIRMED : SURFACE_LABELS[pitch.surface] },
    { label: "Pitch size", value: pitch.pitchFormat === null ? NOT_CONFIRMED : FORMAT_LABELS[pitch.pitchFormat] },
    { label: "Dimensions", value: size },
    { label: "Floodlights", value: pitch.floodlights === null ? NOT_CONFIRMED : pitch.floodlights ? "Yes" : "No" },
    access,
  ];
}
