import { type MapAdapterProps } from "../types";

// Padding for fitting a search's area clear of whatever covers the map (3.8). Pure, so it's
// unit-tested without Mapbox. Mapbox won't fit at all when the padding leaves no room, which the
// list-focused mobile sheet would otherwise do (it leaves only a strip of map), so the padding is
// clamped to keep some of the map usable: the room around the area goes first, then the covered
// part is shrunk proportionally.

export const FIT_PADDING_PX = 48;
/** The least of the map (px, each axis) a fitted view keeps for the search's area. */
export const MIN_FIT_PX = 48;

type Sides = MapAdapterProps["obscured"];

function axis(low: number, high: number, size: number): [number, number] {
  const wanted = low + high + 2 * FIT_PADDING_PX;
  // Not measured yet (0): nothing to clamp against.
  if (size <= 0 || wanted <= size - MIN_FIT_PX) return [low + FIT_PADDING_PX, high + FIT_PADDING_PX];
  const room = Math.max(0, size - MIN_FIT_PX);
  const covered = low + high;
  if (covered < room) {
    const margin = (room - covered) / 2;
    return [low + margin, high + margin];
  }
  const scale = covered === 0 ? 0 : room / covered;
  return [low * scale, high * scale];
}

export function fitPadding(obscured: Sides, width: number, height: number): Sides {
  const [top, bottom] = axis(obscured.top, obscured.bottom, height);
  const [left, right] = axis(obscured.left, obscured.right, width);
  return { top, bottom, left, right };
}
