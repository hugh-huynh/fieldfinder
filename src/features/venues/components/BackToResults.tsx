"use client";

import Link from "next/link";

import { useLastSearch } from "@/features/search/last-search";

// The detail pages' back link (PR 3.10): to the last search results seen in this tab, with its place
// and filters; else to search. The browser's Back button still restores the exact list and map (3.6).

export function BackToResults() {
  const lastSearch = useLastSearch();
  return (
    <Link
      href={lastSearch ?? "/"}
      className="inline-flex min-h-10 items-center gap-1 rounded-pill text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true">←</span> {lastSearch === null ? "Search soccer fields" : "Back to results"}
    </Link>
  );
}
