import { z } from "zod";

// Where the person was on a search page, kept in that page's own history entry (PR 3.6, spec §1:
// "browser back restores location, filters, map viewport and scroll"). The URL already holds the
// place and filters; this adds what doesn't belong in a shareable URL: the map's viewport, the
// list's scroll position and how many venues were loaded.
//
// - Written with history.replaceState, so it never adds history entries: only a search (or, from
//   3.7, applying filters) pushes one. Next.js keeps its own keys when we do this.
// - Read back when the page shows that entry again (back/forward, reload). It is tied to the search
//   it was saved for, so a stale entry can't move the map for a different search.
// - Whatever is in history.state is treated as untrusted and validated; anything odd is ignored.
// - No precise user location is stored: only the map's viewport and the search's own (already
//   rounded) query.

const STATE_KEY = "fieldfinder:search";
/** Writes are batched: Safari throws if a page calls replaceState more than ~100 times in 30 s. */
const WRITE_DELAY_MS = 300;

const boundsSchema = z
  .object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  })
  .refine((b) => b.south <= b.north && b.west <= b.east);

const savedSchema = z.object({
  /** The canonical API query of the search this was saved for (apiQueryString). */
  query: z.string().max(2000),
  bounds: boundsSchema.optional(),
  scrollY: z.number().int().min(0).max(1_000_000).optional(),
  loaded: z.number().int().min(0).max(10_000).optional(),
});

export type SavedSearchView = z.infer<typeof savedSchema>;

function currentState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
}

/** What was saved in the current history entry for `query`, or null (also on the server). */
export function readSavedView(query: string | null): SavedSearchView | null {
  if (query === null || typeof window === "undefined") return null;
  const parsed = savedSchema.safeParse(currentState()[STATE_KEY]);
  return parsed.success && parsed.data.query === query ? parsed.data : null;
}

let pending: { query: string; patch: Partial<Omit<SavedSearchView, "query">> } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const next = pending;
  pending = null;
  if (next === null) return;
  const state = currentState();
  const previous = savedSchema.safeParse(state[STATE_KEY]);
  const base = previous.success && previous.data.query === next.query ? previous.data : { query: next.query };
  try {
    window.history.replaceState({ ...state, [STATE_KEY]: { ...base, ...next.patch } }, "", window.location.href);
  } catch {
    // Too many calls (Safari) or a sandboxed frame: losing a restore point is harmless.
  }
}

/** Remember part of where the person is on `query`'s results (batched). */
export function saveSearchView(query: string, patch: Partial<Omit<SavedSearchView, "query">>): void {
  pending = pending?.query === query ? { query, patch: { ...pending.patch, ...patch } } : { query, patch };
  timer ??= setTimeout(flush, WRITE_DELAY_MS);
}

/** Write now: the page is about to go to another history entry (a card or preview was activated). */
export function flushSavedView(): void {
  if (timer !== null) clearTimeout(timer);
  flush();
}
