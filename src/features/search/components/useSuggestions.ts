"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { suggestQuery, type LocationSuggestionDto, type SuggestResponse } from "@/features/locations/query";

// Place suggestions for the search box (PR 3.2). Each request costs a Mapbox call and counts against
// the 30/min/IP Firewall rule on /api/locations/ (ADR-0004), so:
// - nothing is sent until typing pauses for SUGGEST_DEBOUNCE_MS (Enter can skip the wait: `settle`);
// - queries the API would reject (under 2 characters, odd symbols) are never sent;
// - one request per query: `settle` and the debounce share it (a failed one isn't kept, so it can be retried);
// - a newer query aborts the older request, and an answer only counts for the query it was asked for.
// Answers aren't kept beyond the current query: Mapbox's free "temporary" results may not be stored.

export const SUGGEST_DEBOUNCE_MS = 250;

export type Settled =
  { status: "ready"; suggestions: LocationSuggestionDto[] } | { status: "error"; suggestions: LocationSuggestionDto[] };

export type SuggestionsState =
  | { status: "idle"; suggestions: LocationSuggestionDto[] }
  | { status: "loading"; suggestions: LocationSuggestionDto[] }
  | Settled;

const NONE: LocationSuggestionDto[] = [];

interface Request {
  query: string;
  controller: AbortController;
  promise: Promise<Settled>;
}

/**
 * Suggestions for `input` (null when the box isn't being edited, e.g. it shows the URL's place), and
 * `settle()`, which asks now instead of after the debounce and resolves with the answer.
 */
export function useSuggestions(input: string | null): SuggestionsState & { settle: () => Promise<Settled | null> } {
  const query = input === null ? null : suggestQuery(input);
  const [answer, setAnswer] = useState<{ query: string; settled: Settled } | null>(null);
  const inflight = useRef<Request | null>(null);

  const request = useCallback((q: string): Promise<Settled> => {
    if (inflight.current?.query === q) return inflight.current.promise;
    inflight.current?.controller.abort();
    const controller = new AbortController();
    const promise = fetch(`/api/locations/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then(async (res): Promise<Settled> => {
        if (!res.ok) throw new Error(`suggest ${String(res.status)}`);
        const body = (await res.json()) as SuggestResponse;
        return { status: "ready", suggestions: body.suggestions };
      })
      .catch((): Settled => ({ status: "error", suggestions: NONE }));
    const req: Request = { query: q, controller, promise };
    void promise.then((settled) => {
      // A failure isn't reused: the next ask for this query (Enter, or retyping it) tries again.
      if (settled.status === "error" && inflight.current === req) inflight.current = null;
      if (!controller.signal.aborted) setAnswer({ query: q, settled });
    });
    inflight.current = req;
    return promise;
  }, []);

  useEffect(() => {
    if (query === null) return;
    const timer = setTimeout(() => void request(query), SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, request]);

  // Abort whatever is in flight when the box goes away.
  useEffect(
    () => () => {
      inflight.current?.controller.abort();
    },
    [],
  );

  const settle = useCallback(() => (query === null ? Promise.resolve(null) : request(query)), [query, request]);

  if (query === null) return { status: "idle", suggestions: NONE, settle };
  if (answer?.query === query) return { ...answer.settled, settle };
  // Keep showing the previous list while the next one loads, so it doesn't flicker on each key.
  return { status: "loading", suggestions: answer?.settled.suggestions ?? NONE, settle };
}
