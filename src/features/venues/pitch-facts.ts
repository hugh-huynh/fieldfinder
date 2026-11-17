import type { PitchDto } from "@/features/pitches/dto";
import { ACCESS_LABELS, FORMAT_LABELS, SURFACE_LABELS } from "@/features/search/format";

// A pitch's confirmed facts, worded for its card on the venue page (PR 3.10). Unconfirmed values are
// left out, never guessed or shown as "no" (CLAUDE.md rule 4); the pitch page (3.11) lists every spec
// with "Not confirmed" where unknown.

export function pitchFacts(pitch: PitchDto): string[] {
  const facts: string[] = [];
  if (pitch.surface !== null) facts.push(SURFACE_LABELS[pitch.surface]);
  if (pitch.pitchFormat !== null) facts.push(FORMAT_LABELS[pitch.pitchFormat]);
  if (pitch.lengthMeters !== null && pitch.widthMeters !== null) {
    facts.push(`${String(pitch.lengthMeters)} × ${String(pitch.widthMeters)} m`);
  }
  if (pitch.floodlights !== null) facts.push(pitch.floodlights ? "Floodlights" : "No floodlights");
  if (pitch.effectiveAccess !== null) facts.push(ACCESS_LABELS[pitch.effectiveAccess]);
  return facts;
}
