import Link from "next/link";
import { Suspense } from "react";

import { PitchMark } from "./icons";
import { SearchBar, SearchBarFallback } from "./SearchBar";

// The site header on every page (root layout): the wordmark, then the one search control and the one
// Filters button (spec §3, CLAUDE.md rule 6). No sort, chips, saved or log-in controls (rule 4).
// The search bar reads the URL on the client, so it sits in Suspense; the fallback has no controls.

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      {/* Fixed height: the search layout sizes itself from --header-h (globals.css). */}
      <div className="mx-auto flex h-(--header-h) max-w-screen-2xl flex-wrap content-center items-center gap-x-6 gap-y-3 px-4 sm:flex-nowrap lg:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-pill text-xl font-bold tracking-tight text-ink"
        >
          <PitchMark className="size-8 text-primary" />
          FieldFinder
        </Link>
        <Suspense fallback={<SearchBarFallback />}>
          <SearchBar />
        </Suspense>
      </div>
    </header>
  );
}
