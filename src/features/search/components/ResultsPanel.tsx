"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

import { activeFilterCount } from "../state";

import { editFilters, focusLocationSearch } from "./search-controls";
import { resultsScroller, useSearchResults } from "./SearchResultsContext";
import { VenueCard } from "./VenueCard";

// The results list for the URL's search (spec §3, PR 3.3): loading skeletons, an error with Retry,
// a no-results state offering "Edit filters" and "Search another area", the venue cards, and
// "Show more venues" (D7: the map will show the loaded venues only). One polite status region
// announces each outcome. After "Show more", focus moves to the first new venue so keyboard and
// screen-reader users continue where the list grew. Pointing at a card (hover or keyboard focus)
// highlights its marker on the map (PR 3.4). Coming back to this search via back/forward or reload,
// the list scrolls back to where the person left it once the venues are in (3.6).

export function ResultsPanel() {
  const { state, search, saved, results, setHighlightedId, clearHighlight } = useSearchResults();
  const list = useRef<HTMLUListElement>(null);
  /** Index of the first venue a "Show more" will add; focused once it arrives. */
  const focusFrom = useRef<number | null>(null);

  const count = results.status === "ready" ? results.items.length : 0;
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || count <= from) return;
    focusFrom.current = null;
    list.current?.querySelectorAll<HTMLAnchorElement>(":scope > li h2 a")[from]?.focus();
  }, [count]);

  // Once per return to this entry: the saved scroll position, after the venues have rendered.
  const scrolledFor = useRef<typeof saved>(null);
  useEffect(() => {
    if (saved?.scrollY === undefined || results.status !== "ready" || scrolledFor.current === saved) return;
    scrolledFor.current = saved;
    resultsScroller()?.scrollTo({ top: saved.scrollY, behavior: "instant" });
  }, [saved, results.status]);

  // A fresh search (or a return with no saved position) starts at the top. The scroll container
  // outlives the search (3.8), so Next.js's page-scroll reset doesn't reach it.
  useEffect(() => {
    if (saved?.scrollY !== undefined) return;
    const scroller = resultsScroller();
    if (scroller !== null) scroller.scrollTop = 0;
  }, [search, saved]);

  const announcement =
    results.status === "loading"
      ? "Loading venues…"
      : results.status === "error"
        ? "Couldn't load venues."
        : results.status === "ready"
          ? results.totalCount === 0
            ? "No venues found."
            : `${String(results.totalCount)} ${results.totalCount === 1 ? "venue" : "venues"} found.`
          : "";

  return (
    <div className="mt-4">
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {results.status === "loading" ? <ResultsSkeleton /> : null}

      {results.status === "error" ? (
        <div className="rounded-card border border-border p-6">
          <p className="font-medium text-ink">Couldn&apos;t load venues.</p>
          <p className="mt-1 text-sm text-muted">Check your connection and try again.</p>
          <Button variant="secondary" className="mt-4" onClick={results.retry}>
            Retry
          </Button>
        </div>
      ) : null}

      {results.status === "ready" && results.items.length === 0 ? (
        <div className="rounded-card border border-border p-6">
          <p className="font-medium text-ink">No venues match this search.</p>
          <p className="mt-1 text-sm text-muted">
            {activeFilterCount(state.filters) > 0
              ? "Try fewer filters or a wider distance, or search another area."
              : "Try a wider distance or search another area."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={editFilters}>
              Edit filters
            </Button>
            <Button variant="secondary" onClick={focusLocationSearch}>
              Search another area
            </Button>
          </div>
        </div>
      ) : null}

      {results.status === "ready" && results.items.length > 0 ? (
        <>
          <p className="text-sm text-muted" aria-hidden="true">
            {results.totalCount} {results.totalCount === 1 ? "venue" : "venues"}
          </p>
          <ul ref={list} aria-label="Venues" className="mt-2 flex flex-col gap-2">
            {results.items.map((venue) => (
              // Hover and focus here only mirror the card onto its map marker (PR 3.4); the card's own
              // link is the control, so the item itself takes no action.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- reason: highlight-only, the link inside is the control
              <li
                key={venue.id}
                onMouseEnter={() => {
                  setHighlightedId(venue.id);
                }}
                onMouseLeave={() => {
                  clearHighlight(venue.id);
                }}
                onFocus={() => {
                  setHighlightedId(venue.id);
                }}
                onBlur={() => {
                  clearHighlight(venue.id);
                }}
              >
                <VenueCard venue={venue} />
              </li>
            ))}
          </ul>

          {results.nextCursor !== null ? (
            <div className="mt-6 flex flex-col items-center gap-2">
              <p className="text-sm text-muted">
                Showing {results.items.length} of {results.totalCount}
              </p>
              <Button
                variant="secondary"
                // Not disabled while loading: that would drop keyboard focus. A second press is ignored.
                aria-busy={results.more === "loading"}
                onClick={() => {
                  focusFrom.current = results.items.length;
                  results.showMore();
                }}
              >
                {results.more === "loading" ? "Loading…" : "Show more venues"}
              </Button>
              {results.more === "error" ? (
                <p role="alert" className="text-sm text-danger">
                  Couldn&apos;t load more venues. Try again.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex gap-4 p-2">
          <Skeleton className="aspect-[4/3] w-32 shrink-0 sm:w-44" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-1 h-6 w-1/2 rounded-pill" />
          </div>
        </li>
      ))}
    </ul>
  );
}
