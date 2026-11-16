import { Skeleton } from "@/components/ui/Skeleton";
import { MapPlaceholder, SearchLayout } from "@/features/search/components/SearchLayout";
import { parseSearchState } from "@/features/search/state";

// `/`: search results (spec §3). PR 3.2 is the frame only: the heading follows the URL's place, and
// the list shows a prompt or placeholders until the results list (3.3) and map (3.4) land.

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
              <p className="sr-only">Venue results for this place aren&apos;t available yet.</p>
              <ul aria-hidden="true" className="mt-6 flex flex-col gap-4">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex gap-4">
                    <Skeleton className="h-28 w-40 shrink-0 rounded-card" />
                    <div className="flex flex-1 flex-col gap-2 py-1">
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-4 w-1/3" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        }
      />
    </main>
  );
}
