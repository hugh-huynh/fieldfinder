"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { apiQueryString, parseSearchState, type SearchState } from "../state";

import { useVenueSearch } from "./useVenueSearch";

// One search, shared by the list and the map (spec §1: "search results and map remain synchronized";
// PR 3.4). The provider loads the URL's search once; the list renders the venues and the map renders
// their markers (D7: loaded venues only). It also holds which venue the list is pointing at
// (hover/focus highlights its marker) and which marker the person chose on the map.

interface SearchResults {
  state: SearchState;
  results: ReturnType<typeof useVenueSearch>;
  highlightedId: string | null;
  setHighlightedId: (id: string | null) => void;
  /** Clears the highlight only if it's still `id`, so leaving one card can't clear the next one's. */
  clearHighlight: (id: string) => void;
  selectedId: string | null;
  /** Chooses a marker, or un-chooses it if it's already chosen. */
  toggleSelected: (id: string) => void;
}

/** A venue id and the search (canonical API query) it was highlighted or chosen in. */
type Interaction = { search: string | null; id: string } | null;

const SearchResultsContext = createContext<SearchResults | null>(null);

export function SearchResultsProvider({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const query = params.toString();
  const state = useMemo(() => parseSearchState(new URLSearchParams(query)), [query]);
  const results = useVenueSearch(state);
  // Each id is kept with the search it was made in, so a new search drops it even if that search
  // also returns the same venue.
  const search = apiQueryString(state);
  const [highlighted, setHighlighted] = useState<Interaction>(null);
  const [selected, setSelected] = useState<Interaction>(null);

  // Only venues of this search, on the list, can be highlighted or chosen.
  const loaded = (interaction: Interaction) =>
    interaction !== null &&
    interaction.search === search &&
    results.status === "ready" &&
    results.items.some((item) => item.id === interaction.id)
      ? interaction.id
      : null;
  const selectedId = loaded(selected);

  const value: SearchResults = {
    state,
    results,
    highlightedId: loaded(highlighted),
    setHighlightedId: (id) => {
      setHighlighted(id === null ? null : { search, id });
    },
    clearHighlight: (id) => {
      setHighlighted((current) => (current?.id === id ? null : current));
    },
    selectedId,
    toggleSelected: (id) => {
      setSelected(selectedId === id ? null : { search, id });
    },
  };

  return <SearchResultsContext value={value}>{children}</SearchResultsContext>;
}

export function useSearchResults(): SearchResults {
  const value = useContext(SearchResultsContext);
  if (value === null) throw new Error("useSearchResults needs a SearchResultsProvider");
  return value;
}
