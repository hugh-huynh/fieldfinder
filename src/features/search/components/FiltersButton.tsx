"use client";

import { cx } from "@/lib/cx";

import { FiltersIcon } from "./icons";

// The single Filters button, directly beside the location search (spec §3, CLAUDE.md rule 6). Its
// badge counts the applied filters that differ from the defaults. The dialog it opens is PR 3.7.
// On narrow screens the word "Filters" is visually hidden but stays the button's accessible name.

export function FiltersButton({ activeCount, onClick }: { activeCount: number; onClick?: () => void }) {
  const name = activeCount === 0 ? "Filters" : `Filters, ${String(activeCount)} active`;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={name}
      onClick={onClick}
      className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-pill border border-border-strong bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:bg-subtle sm:px-5"
    >
      <FiltersIcon className="size-5" />
      <span aria-hidden="true" className="sr-only sm:not-sr-only">
        Filters
      </span>
      {activeCount > 0 ? (
        <span
          aria-hidden="true"
          className={cx(
            "inline-flex min-w-5 items-center justify-center rounded-pill bg-primary px-1.5 text-xs leading-5 font-semibold text-surface",
          )}
        >
          {activeCount}
        </span>
      ) : null}
    </button>
  );
}
