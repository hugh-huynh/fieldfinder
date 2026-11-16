import { Suspense } from "react";

import { ResultsPanel, ResultsSkeleton } from "@/features/search/components/ResultsPanel";
import { MapPlaceholder, SearchLayout } from "@/features/search/components/SearchLayout";
import { parseSearchState } from "@/features/search/state";

// `/`: search results (spec §3). The heading follows the URL's place; the results list (3.3) loads
// on the client from GET /api/venues. The map arrives with 3.4 and the 3-snap sheet with 3.6.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toUrlSearchParams(raw: Awaited<SearchParams>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const item of ([] as (string | undefined)[]).concat(value)) if (item !== undefined) params.append(key, item);
  }
  return params;
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const { location } = parseSearchState(toUrlSearchParams(await searchParams));

  return (
    <main>
      <SearchLayout
        map={<MapPlaceholder />}
        list={
          location === null ? (
            <div className="max-w-xl">
              <h1 className="text-2xl font-semibold text-ink">Find a soccer field</h1>
              <p className="mt-2 text-muted">Search a suburb or place to see public soccer fields nearby.</p>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-semibold text-ink">
                Soccer fields near {location.label ?? "the selected place"}
              </h1>
              <Suspense fallback={<ResultsSkeleton />}>
                <ResultsPanel />
              </Suspense>
            </div>
          )
        }
      />
    </main>
  );
}
