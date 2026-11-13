import { type ReactNode } from "react";

// The search page's frame (spec §3): on desktop the venue list (~55%) beside a sticky map (~45%); on
// mobile the map above the results sheet. The map (3.4) and the draggable 3-snap sheet (3.6) replace
// the placeholders here; the list content is 3.3.

export function SearchLayout({ list, map }: { list: ReactNode; map: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-var(--header-h))] flex-col lg:grid lg:grid-cols-[55fr_45fr]">
      <div className="order-1 h-[45dvh] shrink-0 lg:sticky lg:top-(--header-h) lg:order-2 lg:h-[calc(100dvh-var(--header-h))]">
        {map}
      </div>
      <div className="relative z-10 order-2 -mt-4 flex-1 rounded-t-card bg-surface px-4 pt-6 pb-8 lg:order-1 lg:mt-0 lg:rounded-none lg:px-6">
        {list}
      </div>
    </div>
  );
}

/** Stands in for the map until 3.4. Decorative, so it's hidden from assistive tech. */
export function MapPlaceholder() {
  return <div aria-hidden="true" className="size-full bg-subtle" />;
}
