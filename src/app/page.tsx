import { Suspense, type ReactNode } from "react";

import { LegalLinks } from "@/components/SiteFooter";
import { SearchMap } from "@/features/map/components/SearchMap";
import { ResultsPanel, ResultsSkeleton } from "@/features/search/components/ResultsPanel";
import { SearchResultsProvider } from "@/features/search/components/SearchResultsContext";
import { UseMyLocation } from "@/features/search/components/UseMyLocation";
import { MapPlaceholder, SearchLayout } from "@/features/search/components/SearchLayout";
import { parseSearchState, type SearchLocation } from "@/features/search/state";

// `/`: search results (spec §3). The heading follows the URL's place; the results list (3.3) and the
// map (3.4) share one search, loaded on the client from GET /api/venues. The 3-snap sheet is 3.8.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toUrlSearchParams(raw: Awaited<SearchParams>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const item of ([] as (string | undefined)[]).concat(value)) if (item !== undefined) params.append(key, item);
  }
  return params;
}

function ListColumn({
  location,
  results,
  locate = true,
}: {
  location: SearchLocation | null;
  results: ReactNode;
  /** "Use my location" (3.9); left out of the loading fallback. */
  locate?: boolean;
}) {
  if (location === null) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold text-ink">Find a soccer field</h1>
        <p className="mt-2 text-muted">Search a suburb or place to see public soccer fields nearby.</p>
        {/* Fills in the place by itself only when location access is already allowed. */}
        {locate ? <UseMyLocation autoFill /> : null}
        <LegalLinks className="mt-10" />
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">
        {/* A place without a name is a "Search this area" search (3.6), or a hand-made link. */}
        {location.label === null ? "Soccer fields in this area" : `Soccer fields near ${location.label}`}
      </h1>
      {locate ? <UseMyLocation compact /> : null}
      {results}
      <LegalLinks className="mt-10 pb-4" />
    </div>
  );
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const { location } = parseSearchState(toUrlSearchParams(await searchParams));

  return (
    <main>
      <Suspense
        fallback={
          <SearchLayout
            map={<MapPlaceholder />}
            list={<ListColumn location={location} results={<ResultsSkeleton />} locate={false} />}
          />
        }
      >
        <SearchResultsProvider>
          <SearchLayout map={<SearchMap />} list={<ListColumn location={location} results={<ResultsPanel />} />} />
        </SearchResultsProvider>
      </Suspense>
    </main>
  );
}
