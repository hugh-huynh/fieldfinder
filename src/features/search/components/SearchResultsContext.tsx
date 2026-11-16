"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { flushSavedView, readSavedView, saveSearchView, type SavedSearchView } from "../history-state";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../query";
import { apiQueryString, parseSearchState, type SearchState } from "../state";

import { useVenueSearch } from "./useVenueSearch";

// One search, shared by the list and the map (spec §1: "search results and map remain synchronized";
// PR 3.4). The provider loads the URL's search once; the list renders the venues and the map renders
// their markers (D7: loaded venues only). It also holds which venue the list is pointing at
// (hover/focus highlights its marker) and which marker the person chose on the map.
//
// History (PR 3.6): it reads what was saved in this history entry for this search (map viewport,
// list scroll, venues loaded) so a return via back/forward or reload can put them back, and keeps
// the scroll position and loaded count saved as they change.

interface SearchResults {
  state: SearchState;
  /** The canonical API query of this search (null without a place): what saved views are tied to. */
  search: string | null;
  /** Saved for this search in this history entry, if the person is coming back to it. */
  saved: SavedSearchView | null;
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
  const search = apiQueryString(state);

  // Read once per history entry (a new URL), never again while the person is on it. Pushing a new
  // search renders before Next.js adds its history entry, so the old entry is read then; it was saved
  // for a different search, so it's ignored. On the server there's no history: nothing is restored.
  const [entry, setEntry] = useState(() => ({ query, saved: readSavedView(search) }));
  if (entry.query !== query) setEntry({ query, saved: readSavedView(search) });
  const saved = entry.query === query ? entry.saved : null;

  // Coming back to a list that had grown with "Show more": ask for as many venues at once as were
  // loaded (up to the API's page size), so the saved scroll position can be reached again.
  const firstPageLimit =
    saved?.loaded !== undefined && saved.loaded > DEFAULT_LIMIT ? Math.min(saved.loaded, MAX_LIMIT) : undefined;
  const results = useVenueSearch(state, { firstPageLimit });

  // Keep where the person is on this search saved in its history entry.
  const loadedCount = results.status === "ready" ? results.items.length : null;
  useEffect(() => {
    if (search !== null && loadedCount !== null) saveSearchView(search, { loaded: loadedCount });
  }, [search, loadedCount]);
  useEffect(() => {
    if (search === null) return;
    const onScroll = () => {
      saveSearchView(search, { scrollY: Math.round(window.scrollY) });
    };
    // Activating a card, a preview or a place leaves this entry: write what's pending first.
    const onClick = () => {
      flushSavedView();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
    };
  }, [search]);

  // Each id is kept with the search it was made in, so a new search drops it even if that search
  // also returns the same venue.
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
    search,
    saved,
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
