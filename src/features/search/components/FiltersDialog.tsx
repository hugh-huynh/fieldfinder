"use client";

import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { Button } from "@/components/ui/Button";
import { ACCESS_CLASSES, AMENITY_KEYS, PITCH_FORMATS, SURFACES, type AccessClass } from "@/lib/domain/enums";

import { AMENITY_LABELS, FORMAT_LABELS, SURFACE_LABELS } from "../format";
import { MAX_RADIUS_KM, MIN_RADIUS_KM } from "../query";
import {
  activeFilterCount,
  filterDialogReducer,
  initialFilterDialogState,
  type FilterAction,
  type SearchFilters,
} from "../state";

import { FiltersButton } from "./FiltersButton";

// The one Filters button and the dialog it opens (spec §3 "Filter dialog", PR 3.7). One component
// for every screen size: a centred modal from `sm`, a bottom sheet up to the full height below it.
//
// - Opens only from the Filters button (or "Edit filters", which presses it).
// - The person edits a draft (PR 3.1 reducer). Nothing is searched until "Show venues": no request
//   fires while they change things.
// - "Clear all" resets the draft to the defaults; the results don't change until "Show venues".
// - Cancel, the X and Escape throw the draft away and put focus back where it was before opening.
// - "Show venues" (or Enter) applies the draft by pushing one URL, so the list and the map change
//   together, as one history entry (3.6).
// - Date & time and Players aren't backed by data yet, so they're shown disabled and labelled as not
//   yet available (C6), never as working controls.
// - A native <dialog> opened with showModal(): the browser keeps focus inside it and makes the
//   page behind it inert.

const ACCESS_LABELS: Record<AccessClass, string> = {
  public: "Public access",
  booking_required: "Booking required",
  members_only: "Members only",
};

const LIGHTING = [
  { value: "any", label: "Any" },
  { value: "yes", label: "With lighting" },
  { value: "no", label: "No lighting" },
] as const;

export function FiltersControl({
  filters,
  onApply,
}: {
  /** The applied filters (from the URL). */
  filters: SearchFilters;
  onApply: (filters: SearchFilters) => void;
}) {
  const [state, dispatch] = useReducer(filterDialogReducer, filters, initialFilterDialogState);
  const dialog = useRef<HTMLDialogElement>(null);
  /** What had focus before the dialog opened: focus goes back there when it closes. */
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // The URL's filters changed (applied here, back/forward, a link): adopt them, closing the dialog.
  const urlKey = JSON.stringify(filters);
  const [seenKey, setSeenKey] = useState(urlKey);
  if (seenKey !== urlKey) {
    setSeenKey(urlKey);
    dispatch({ type: "syncFromUrl", filters });
  }

  const open = state.draft !== null;
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) {
      element.close();
      opener.current?.focus();
      opener.current = null;
    }
  }, [open]);

  function openDialog(event: MouseEvent<HTMLButtonElement>) {
    // Safari doesn't focus a button when it's clicked or tapped, so nothing may have focus: then focus
    // returns to the Filters button itself.
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : event.currentTarget;
    dispatch({ type: "open" });
  }

  function apply(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (state.draft === null) return;
    const draft = state.draft;
    dispatch({ type: "apply" });
    onApply(draft);
  }

  const draft = state.draft;

  return (
    <>
      <FiltersButton activeCount={activeFilterCount(state.applied)} onClick={openDialog} />
      {/* Escape and backdrop clicks close a modal dialog: the APG dialog pattern, not extra controls. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- reason: APG modal dialog, Escape and backdrop close */}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        // Escape, or the platform's own "close" gesture: the same as Cancel.
        onCancel={(event) => {
          event.preventDefault();
          dispatch({ type: "cancel" });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          dispatch({ type: "cancel" });
        }}
        // A click on the backdrop lands on the dialog element itself: the same as Cancel.
        onClick={(event) => {
          if (event.target === event.currentTarget) dispatch({ type: "cancel" });
        }}
        className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-dvh w-full max-w-none overflow-hidden rounded-t-card bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/40 sm:inset-0 sm:m-auto sm:max-h-[85dvh] sm:max-w-2xl sm:rounded-card"
      >
        {draft === null ? null : (
          <form onSubmit={apply} className="flex max-h-[inherit] flex-col">
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 id={titleId} className="text-lg font-semibold">
                Filters
              </h2>
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => {
                  dispatch({ type: "cancel" });
                }}
                className="inline-flex size-10 items-center justify-center rounded-pill text-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="size-5"
                >
                  <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-6 sm:grid-cols-2 sm:gap-x-8">
                <div className="flex flex-col gap-6">
                  <RadiusField radiusKm={draft.radiusKm} dispatch={dispatch} />
                  <ComingSoon title="Date & time" />
                  <ComingSoon title="Players" />
                </div>
                <div className="flex flex-col gap-6">
                  <ChoiceGroup
                    legend="Surface type"
                    name="surface"
                    value={draft.surface ?? "any"}
                    options={[
                      { value: "any", label: "Any" },
                      ...SURFACES.map((s) => ({ value: s, label: SURFACE_LABELS[s] })),
                    ]}
                    onChange={(value) => {
                      dispatch({
                        type: "setChoice",
                        field: "surface",
                        value: SURFACES.find((s) => s === value) ?? null,
                      });
                    }}
                  />
                  <ChoiceGroup
                    legend="Pitch size"
                    name="pitchSize"
                    value={draft.pitchSize ?? "any"}
                    options={[
                      { value: "any", label: "Any" },
                      ...PITCH_FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f] })),
                    ]}
                    onChange={(value) => {
                      dispatch({
                        type: "setChoice",
                        field: "pitchSize",
                        value: PITCH_FORMATS.find((f) => f === value) ?? null,
                      });
                    }}
                  />
                  <ChoiceGroup
                    legend="Lighting"
                    name="lighting"
                    value={draft.lighting === null ? "any" : draft.lighting ? "yes" : "no"}
                    options={LIGHTING}
                    onChange={(value) => {
                      dispatch({
                        type: "setChoice",
                        field: "lighting",
                        value: value === "yes" ? true : value === "no" ? false : null,
                      });
                    }}
                  />
                  <fieldset>
                    <legend className="text-sm font-semibold">Facilities</legend>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                      {AMENITY_KEYS.map((key) => (
                        <label key={key} className="flex min-h-8 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={draft.amenities.includes(key)}
                            onChange={() => {
                              dispatch({ type: "toggleAmenity", amenity: key });
                            }}
                            className="size-5 accent-primary"
                          />
                          {AMENITY_LABELS[key]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <ChoiceGroup
                    legend="Access type"
                    name="access"
                    value={draft.access ?? "any"}
                    options={[
                      { value: "any", label: "Any" },
                      ...ACCESS_CLASSES.map((a) => ({ value: a, label: ACCESS_LABELS[a] })),
                    ]}
                    onChange={(value) => {
                      dispatch({
                        type: "setChoice",
                        field: "access",
                        value: ACCESS_CLASSES.find((a) => a === value) ?? null,
                      });
                    }}
                  />
                </div>
              </div>
            </div>

            <footer className="flex items-center gap-2 border-t border-border px-6 py-4">
              <Button
                variant="ghost"
                className="mr-auto px-2"
                onClick={() => {
                  dispatch({ type: "clearAll" });
                }}
              >
                Clear all
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  dispatch({ type: "cancel" });
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Show venues</Button>
            </footer>
          </form>
        )}
      </dialog>
    </>
  );
}

function RadiusField({ radiusKm, dispatch }: { radiusKm: number; dispatch: (action: FilterAction) => void }) {
  const id = useId();
  const valueText = `Within ${String(radiusKm)} km`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-semibold">
          Distance
        </label>
        <output htmlFor={id} className="text-sm text-muted">
          {valueText}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={MIN_RADIUS_KM}
        max={MAX_RADIUS_KM}
        step={1}
        value={radiusKm}
        aria-valuetext={valueText}
        onChange={(event) => {
          dispatch({ type: "setRadius", radiusKm: Number(event.target.value) });
        }}
        className="mt-3 w-full accent-primary"
      />
    </div>
  );
}

function ChoiceGroup({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold">{legend}</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => {
                onChange(option.value);
              }}
              className="peer sr-only"
            />
            <Pill>{option.label}</Pill>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-10 items-center rounded-pill border border-border-strong px-4 text-sm text-ink transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-surface peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus hover:bg-subtle peer-checked:hover:bg-primary-dark">
      {children}
    </span>
  );
}

/** C6: shown so people know it's planned, but not a control: disabled and labelled unavailable. */
function ComingSoon({ title }: { title: string }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} aria-disabled="true">
      <p id={id} className="text-sm font-semibold text-muted">
        {title} <span className="font-normal">(coming soon — not yet available)</span>
      </p>
      <span
        aria-hidden="true"
        className="mt-3 inline-flex min-h-10 items-center rounded-pill border border-dashed border-border px-4 text-sm text-muted"
      >
        Any
      </span>
    </div>
  );
}
