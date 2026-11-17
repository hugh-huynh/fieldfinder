import { AMENITY_LABELS } from "@/features/search/format";
import { AMENITY_KEYS } from "@/lib/domain/enums";

import type { AmenitiesDto } from "../dto";

// A venue's facilities on its detail page (PR 3.10): every facility FieldFinder tracks, each "Yes",
// "No" or "Not confirmed". Unknown is never shown as no (CLAUDE.md rule 4).

const STATE_LABELS = { yes: "Yes", no: "No" } as const;

export function FacilityList({ amenities }: { amenities: AmenitiesDto }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
      {AMENITY_KEYS.map((key) => {
        const state = amenities[key];
        return (
          <div key={key} className="contents">
            <dt className="text-ink">{AMENITY_LABELS[key]}</dt>
            <dd className={state === "yes" ? "font-medium text-primary-dark" : "text-muted"}>
              {state === undefined ? "Not confirmed" : STATE_LABELS[state]}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
