import { useSyncExternalStore } from "react";

// The last search results page the person saw in this tab (PR 3.10), so a detail page's back link
// returns to it with its place and filters. Memory only: a fresh visit to a detail page links to
// search instead. The URL holds only what the search URL already holds (rounded, ADR-0005).

let lastSearch: string | null = null;
const listeners = new Set<() => void>();

export function rememberSearch(url: string): void {
  if (url === lastSearch) return;
  lastSearch = url;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLastSearch(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => lastSearch,
    () => null,
  );
}
