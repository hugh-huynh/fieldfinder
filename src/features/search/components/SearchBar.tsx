"use client";

import { useRouter, useSearchParams } from "next/navigation";

import type { LocationSuggestionDto } from "@/features/locations/query";

import { activeFilterCount, parseSearchState, placeLocation, serializeSearchState } from "../state";

import { FiltersButton } from "./FiltersButton";
import { LocationSearch } from "./LocationSearch";

// The header's search controls on every page: one location search and, directly beside it, the one
// Filters button. Choosing a place goes to the search results (`/`) for it, keeping the current
// filters (PR 3.1 state model).

/** "Brunswick, Victoria 3056, Australia" → "Brunswick, Victoria 3056": every result is in Australia. */
function placeLabel(suggestion: LocationSuggestionDto): string {
  return suggestion.label.replace(/,\s*Australia$/, "");
}

export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const state = parseSearchState(new URLSearchParams(params.toString()));
  const label = state.location?.label ?? "";

  function onSelect(suggestion: LocationSuggestionDto) {
    const location = placeLocation(suggestion.latitude, suggestion.longitude, placeLabel(suggestion));
    if (location === null) return;
    const query = serializeSearchState({ location, filters: state.filters });
    router.push(`/?${query}`);
  }

  return (
    <div role="search" aria-label="Find soccer fields" className="flex w-full max-w-2xl items-center gap-2">
      {/* Not keyed by the place: the box follows URL changes itself, so it keeps focus after a choice. */}
      <LocationSearch initialLabel={label} onSelect={onSelect} />
      <FiltersButton activeCount={activeFilterCount(state.filters)} />
    </div>
  );
}

/** Same footprint while the search params load, with no controls (so there's never a second box). */
export function SearchBarFallback() {
  return (
    <div aria-hidden="true" className="flex w-full max-w-2xl items-center gap-2">
      <div className="min-h-12 flex-1 rounded-pill border border-border-strong bg-surface" />
      <div className="size-12 rounded-pill border border-border-strong bg-surface sm:w-28" />
    </div>
  );
}
