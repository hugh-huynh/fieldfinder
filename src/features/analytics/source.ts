import { INTERACTION_SOURCES, type InteractionSource } from "./events";

// Where a venue or pitch page was opened from (spec §7 "interaction source (map/list)"). Links on the
// results list and the map's preview carry `data-analytics-source`; a click notes it here (memory
// only), and the detail page's view event takes it. A note older than a few seconds is stale (e.g.
// the link opened in another tab), so the view counts as "direct".

const FRESH_MS = 10_000;

let pending: { source: InteractionSource; at: number } | null = null;

function isSource(value: string | undefined): value is InteractionSource {
  return (INTERACTION_SOURCES as readonly string[]).includes(value ?? "");
}

export function noteSource(value: string | undefined, now = Date.now()): void {
  pending = isSource(value) ? { source: value, at: now } : null;
}

/** The noted source if it's fresh, otherwise "direct". Either way the note is used up. */
export function takeSource(now = Date.now()): InteractionSource {
  const noted = pending;
  pending = null;
  return noted !== null && now - noted.at <= FRESH_MS ? noted.source : "direct";
}
