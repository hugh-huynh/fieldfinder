"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { filterParams } from "@/features/analytics/events";
import { track } from "@/features/analytics/gtag";
import { withoutCountry, type LocationSuggestionDto } from "@/features/locations/query";

import { DEFAULT_RADIUS_KM } from "../query";
import { parseSearchState, placeLocation, serializeSearchState, type SearchFilters } from "../state";

import { FiltersControl } from "./FiltersDialog";
import { LocationSearch } from "./LocationSearch";

// The header's search controls on every page: one location search and, directly beside it, the one
// Filters button. Choosing a place goes to the search results (`/`) for it, keeping the current
// filters (PR 3.1 state model). Applying filters (3.7) goes to the results for the current place
// with the new filters, from any page.

export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const state = parseSearchState(new URLSearchParams(params.toString()));
  const label = state.location?.label ?? "";

  function onSelect(suggestion: LocationSuggestionDto) {
    const location = placeLocation(suggestion.latitude, suggestion.longitude, withoutCountry(suggestion.label));
    if (location === null) return;
    const query = serializeSearchState({ location, filters: state.filters });
    router.push(`/?${query}`);
  }

  function onApplyFilters(filters: SearchFilters) {
    // Which filters are on, not their place (spec §7, PR 4.1).
    track({ name: "filter_fields", params: filterParams(filters, DEFAULT_RADIUS_KM) });
    router.push(`/?${serializeSearchState({ location: state.location, filters })}`);
  }

  return (
    <div role="search" aria-label="Find soccer fields" className="flex w-full max-w-2xl items-center gap-2">
      {/* Not keyed by the place: the box follows URL changes itself, so it keeps focus after a choice. */}
      <LocationSearch initialLabel={label} onSelect={onSelect} />
      <FiltersControl filters={state.filters} onApply={onApplyFilters} />
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
