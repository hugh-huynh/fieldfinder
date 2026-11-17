"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cx } from "@/lib/cx";

import { useOptionalSearchResults } from "./SearchResultsContext";
import { clampSheet, nearestSnap, SNAP_LABELS, snapHeight, SNAPS, stepSnap, type Snap } from "./sheet";

// The search page's frame (spec §3).
// - Desktop (lg): the venue list (~55%) beside the map (~45%). The list scrolls in its own column.
// - Mobile (PR 3.8, D19): the map fills the space under the header and stays mounted; the results
//   are a sheet over it with three snaps: map-focused, balanced and list-focused. The sheet can be
//   dragged by its handle, and the same three snaps are buttons and a keyboard splitter (arrows,
//   Home, End). Each change is announced politely. The sheet grows to balanced when a marker is
//   chosen from the list-focused view (so its preview shows) and when keyboard focus enters a
//   peeking list; it drops to map-focused when keyboard focus enters the map, so a focused marker or
//   control is never hidden under it (WCAG 2.2 "Focus Not Obscured").
//
// The list's scroll container carries data-results-scroller on every screen size: that's what the
// search saves and restores (3.6). The sheet's height is published as --sheet-h (CSS) and through
// useSheet() (JS), so the map keeps its controls, preview, attribution and fitted views clear of it.

const MOBILE_QUERY = "(max-width: 1023.98px)";
/** A press that moves less than this (px) is a tap, not a drag. */
const DRAG_THRESHOLD_PX = 4;

interface SheetState {
  /** True below lg, where the results are a sheet over the map. */
  mobile: boolean;
  /** The sheet's height in px on mobile (null on desktop, or before it's measured). */
  sheetPx: number | null;
}

const SheetContext = createContext<SheetState>({ mobile: false, sheetPx: null });

export function useSheet(): SheetState {
  return useContext(SheetContext);
}

function subscribeMobile(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

function useMobile(): boolean {
  return useSyncExternalStore(
    subscribeMobile,
    // No matchMedia (jsdom): treat as desktop.
    () => typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

export function SearchLayout({ list, map }: { list: ReactNode; map: ReactNode }) {
  const mobile = useMobile();
  const root = useRef<HTMLDivElement>(null);
  const scrollerId = useId();
  const [containerPx, setContainerPx] = useState<number | null>(null);
  const [snap, setSnap] = useState<Snap>("balanced");
  const [dragPx, setDragPx] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const drag = useRef<{ y: number; startPx: number; moved: boolean } | null>(null);

  useEffect(() => {
    const element = root.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setContainerPx(Math.round(entry.contentRect.height));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  function moveTo(next: Snap) {
    if (next === snap) return;
    setSnap(next);
    setAnnouncement(SNAP_LABELS[next].announcement);
  }

  // A marker chosen while the list covers the map: make room for the map and its preview.
  const selectedId = useOptionalSearchResults()?.selectedId ?? null;
  const [seenSelected, setSeenSelected] = useState(selectedId);
  if (seenSelected !== selectedId) {
    setSeenSelected(selectedId);
    if (selectedId !== null && mobile && snap === "list") {
      setSnap("balanced");
      setAnnouncement(SNAP_LABELS.balanced.announcement);
    }
  }

  const sheetPx = !mobile || containerPx === null ? null : (dragPx ?? snapHeight(snap, containerPx));
  const style: CSSProperties & Record<"--sheet-h", string> = {
    "--sheet-h": sheetPx === null ? "50%" : `${String(sheetPx)}px`,
  };

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!mobile || containerPx === null || (event.target as Element).closest("button") !== null) return;
    drag.current = { y: event.clientY, startPx: snapHeight(snap, containerPx), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start === null || containerPx === null) return;
    const dy = start.y - event.clientY;
    if (!start.moved && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    start.moved = true;
    setDragPx(clampSheet(start.startPx + dy, containerPx));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    drag.current = null;
    setDragPx(null);
    if (start?.moved !== true || containerPx === null) return;
    // Where the sheet ends up comes from the release itself, not from `dragPx`: the last move's state
    // update may not have rendered yet when the release arrives (a quick flick, a slow device), and a
    // stale value would leave the sheet where it started.
    moveTo(nearestSnap(clampSheet(start.startPx + (start.y - event.clientY), containerPx), containerPx));
  }

  function onSplitterKey(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowUp" || event.key === "ArrowRight"
        ? stepSnap(snap, 1)
        : event.key === "ArrowDown" || event.key === "ArrowLeft"
          ? stepSnap(snap, -1)
          : event.key === "Home"
            ? "map"
            : event.key === "End"
              ? "list"
              : null;
    if (next === null) return;
    event.preventDefault();
    moveTo(next);
  }

  return (
    <SheetContext value={{ mobile, sheetPx: mobile ? (sheetPx ?? 0) : null }}>
      <div
        ref={root}
        style={style}
        className="relative h-[calc(100dvh-var(--header-h))] overflow-hidden lg:grid lg:grid-cols-[55fr_45fr]"
      >
        <section
          aria-label="Results"
          data-snap={snap}
          className={cx(
            "absolute inset-x-0 bottom-0 z-10 flex h-(--sheet-h) flex-col rounded-t-card bg-surface shadow-[0_-4px_16px_rgb(23_43_32/0.12)]",
            "lg:static lg:z-auto lg:h-auto lg:min-h-0 lg:rounded-none lg:shadow-none",
            dragPx === null && "motion-safe:transition-[height] motion-safe:duration-200",
          )}
        >
          {/* Mobile only: the drag handle (also a keyboard splitter) and the three snap buttons. */}
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              drag.current = null;
              setDragPx(null);
            }}
            className="flex shrink-0 touch-none flex-col items-center gap-2 px-4 pt-2 pb-1 select-none lg:hidden"
          >
            {/* APG window splitter: focusable, arrows/Home/End move between the three sizes. jsx-a11y
                doesn't know a focusable separator is a widget. */}
            {/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- reason: APG window splitter (focusable separator) */}
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="horizontal"
              aria-label="Resize results"
              aria-controls={scrollerId}
              aria-valuemin={0}
              aria-valuemax={SNAPS.length - 1}
              aria-valuenow={SNAPS.indexOf(snap)}
              aria-valuetext={SNAP_LABELS[snap].valueText}
              onKeyDown={onSplitterKey}
              className="flex h-6 w-20 cursor-grab items-center justify-center rounded-pill focus-visible:outline-2 focus-visible:outline-focus"
            >
              <span aria-hidden="true" className="h-1.5 w-12 rounded-pill bg-border-strong" />
            </div>
            {/* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
            <div role="group" aria-label="Results size" className="flex gap-1 self-end">
              {SNAPS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={snap === s}
                  onClick={() => {
                    moveTo(s);
                  }}
                  className={cx(
                    "min-h-8 rounded-pill px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-focus",
                    snap === s ? "bg-ink text-surface" : "text-muted hover:bg-subtle",
                  )}
                >
                  {SNAP_LABELS[s].button}
                </button>
              ))}
            </div>
            <p role="status" className="sr-only">
              {announcement}
            </p>
          </div>

          {/* Focus moving into the list only resizes the sheet; the list's own controls do the rest. */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- reason: focus-in resizes the sheet, no action */}
          <div
            id={scrollerId}
            data-results-scroller=""
            // Keyboard focus entering a peeking list: show enough of it to see what's focused.
            onFocus={() => {
              if (mobile && snap === "map") moveTo("balanced");
            }}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-8 lg:px-6 lg:pt-6"
          >
            {list}
          </div>
        </section>

        {/* Keyboard focus moving into the map only resizes the sheet; the map's own controls do the rest. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- reason: focus-in resizes the sheet, no action */}
        <div
          onFocus={(event) => {
            if (mobile && snap !== "map" && isKeyboardFocus(event.target)) moveTo("map");
          }}
          className="absolute inset-0 z-0 lg:static lg:h-full"
        >
          {map}
        </div>
      </div>
    </SheetContext>
  );
}

/** Focus from the keyboard (not a tap or click, which shouldn't rearrange the screen). */
function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** Fills the map's space while the map's code loads. Decorative, so it's hidden from assistive tech. */
export function MapPlaceholder() {
  return <div aria-hidden="true" className="size-full bg-subtle" />;
}
