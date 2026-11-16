// The mobile results sheet's three snap points (spec §3, D19, PR 3.8): map-focused (a peek of the
// list), balanced (half and half) and list-focused (a strip of map left showing). Heights are in px
// of the sheet's container (the space under the header). Pure, so it's unit-tested without a DOM.

export const SNAPS = ["map", "balanced", "list"] as const;
export type Snap = (typeof SNAPS)[number];

/** The peek: the handle, the snap buttons and the start of the heading. */
const PEEK_PX = 132;
/** List-focused leaves at least this much map showing, so the person can see it's there. */
const MIN_MAP_STRIP_PX = 96;

export const SNAP_LABELS: Record<Snap, { button: string; announcement: string; valueText: string }> = {
  map: { button: "Map", announcement: "Showing the map", valueText: "Map view" },
  balanced: { button: "Split", announcement: "Showing the map and the list", valueText: "Split view" },
  list: { button: "List", announcement: "Showing the list", valueText: "List view" },
};

export function snapHeights(containerPx: number): Record<Snap, number> {
  const list = Math.max(0, containerPx - Math.max(MIN_MAP_STRIP_PX, Math.round(containerPx * 0.12)));
  const map = Math.min(PEEK_PX, list);
  const balanced = Math.min(list, Math.max(map, Math.round(containerPx * 0.5)));
  return { map, balanced, list };
}

export function snapHeight(snap: Snap, containerPx: number): number {
  return snapHeights(containerPx)[snap];
}

/** Where a drag released at `heightPx` settles: the closest snap. */
export function nearestSnap(heightPx: number, containerPx: number): Snap {
  const heights = snapHeights(containerPx);
  let best: Snap = "balanced";
  for (const snap of SNAPS) {
    if (Math.abs(heights[snap] - heightPx) < Math.abs(heights[best] - heightPx)) best = snap;
  }
  return best;
}

/** One step bigger (+1) or smaller (−1), stopping at the ends. */
export function stepSnap(snap: Snap, direction: 1 | -1): Snap {
  const index = Math.min(SNAPS.length - 1, Math.max(0, SNAPS.indexOf(snap) + direction));
  return SNAPS[index] ?? snap;
}

/** A drag never goes past the smallest or largest snap. */
export function clampSheet(heightPx: number, containerPx: number): number {
  const { map, list } = snapHeights(containerPx);
  return Math.min(list, Math.max(map, heightPx));
}
