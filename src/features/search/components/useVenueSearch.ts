"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { VenueSearchResponse, VenueSearchResultDto } from "@/features/search/search";

import { apiQueryString, type SearchState } from "../state";

// Results for the applied search (PR 3.3): the first page whenever the search changes, then more
// pages on request ("Show more"). A newer search aborts the older request, and an answer only counts
// for the search it was asked for, so a slow old page never replaces a newer one. Requests use the
// API's canonical query (3.1), so they are never redirected and share the edge cache.

export type ResultsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      items: VenueSearchResultDto[];
      totalCount: number;
      nextCursor: string | null;
      /** State of the latest "Show more" request. */
      more: "idle" | "loading" | "error";
    };

type Ready = Extract<ResultsState, { status: "ready" }>;

async function fetchPage(query: string, signal: AbortSignal): Promise<VenueSearchResponse> {
  const res = await fetch(`/api/venues?${query}`, { signal });
  if (!res.ok) throw new Error(`search ${String(res.status)}`);
  return (await res.json()) as VenueSearchResponse;
}

export function useVenueSearch(state: SearchState): ResultsState & { retry: () => void; showMore: () => void } {
  const query = apiQueryString(state);
  /** Bumped by Retry, so the same search can be asked again. */
  const [attempt, setAttempt] = useState(0);
  const key = query === null ? null : `${query}#${String(attempt)}`;
  const [result, setResult] = useState<{
    key: string;
    state: Exclude<ResultsState, { status: "idle" | "loading" }>;
  } | null>(null);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (key === null || query === null) return;
    const controller = new AbortController();
    moreController.current?.abort();
    fetchPage(query, controller.signal).then(
      (page) => {
        setResult({
          key,
          state: {
            status: "ready",
            items: page.items,
            totalCount: page.totalCount,
            nextCursor: page.nextCursor,
            more: "idle",
          },
        });
      },
      () => {
        if (!controller.signal.aborted) setResult({ key, state: { status: "error" } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [key, query]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const current: ResultsState =
    key === null ? { status: "idle" } : result?.key === key ? result.state : { status: "loading" };

  function showMore() {
    if (key === null || current.status !== "ready" || current.nextCursor === null || current.more === "loading") return;
    const page = apiQueryString(state, { cursor: current.nextCursor });
    if (page === null) return;
    const ready: Ready = current;
    const update = (next: Partial<Ready>) => {
      setResult((prev) =>
        prev?.key === key && prev.state.status === "ready" ? { key, state: { ...prev.state, ...next } } : prev,
      );
    };
    moreController.current?.abort();
    const controller = new AbortController();
    moreController.current = controller;
    update({ more: "loading" });
    fetchPage(page, controller.signal).then(
      (next) => {
        // Venues can move between pages if data changes mid-scroll; never list one twice.
        const seen = new Set(ready.items.map((item) => item.id));
        update({
          items: [...ready.items, ...next.items.filter((item) => !seen.has(item.id))],
          totalCount: next.totalCount,
          nextCursor: next.nextCursor,
          more: "idle",
        });
      },
      () => {
        if (!controller.signal.aborted) update({ more: "error" });
      },
    );
  }

  return { ...current, retry, showMore };
}
