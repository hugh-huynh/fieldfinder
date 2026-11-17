import { type ReactNode } from "react";

import { cx } from "@/lib/cx";

// Recentre and zoom buttons (PR 3.4), drawn by each adapter over its map. Real buttons with names,
// so keyboard and screen-reader users can zoom without gestures. Mapbox's own controls aren't used,
// so the fake map in tests has exactly the same controls.

export function MapControls({
  onRecentre,
  onZoomIn,
  onZoomOut,
}: {
  onRecentre: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    // Mobile: top right, clear of the results sheet (3.8). Desktop: bottom right.
    <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 lg:top-auto lg:bottom-10">
      <ControlButton label="Recentre map" onClick={onRecentre} className="rounded-pill border border-border-strong">
        <RecentreIcon />
      </ControlButton>
      <div className="flex flex-col overflow-hidden rounded-pill border border-border-strong shadow-md">
        <ControlButton label="Zoom in" onClick={onZoomIn} className="border-b border-border">
          <PlusIcon />
        </ControlButton>
        <ControlButton label="Zoom out" onClick={onZoomOut}>
          <MinusIcon />
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cx(
        "inline-flex size-11 items-center justify-center bg-surface text-ink shadow-md transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
        className,
      )}
    >
      {children}
    </button>
  );
}

function RecentreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5">
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
