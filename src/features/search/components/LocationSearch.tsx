"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import type { LocationSuggestionDto } from "@/features/locations/query";
import { cx } from "@/lib/cx";

import { SearchIcon } from "./icons";
import { useSuggestions } from "./useSuggestions";

// The one location search box (spec §3, CLAUDE.md rule 6). An ARIA 1.2 combobox with a listbox
// popup, "list autocomplete with manual selection" from the ARIA Authoring Practices:
// - typing shows matching places; nothing is selected until the person chooses one;
// - Down/Up move through the list (wrapping); Alt+Down opens it without moving;
// - Enter chooses the highlighted place, or the first one if none is highlighted, and goes to the
//   results. If the list is still loading, Enter chooses its first place when it arrives;
// - Escape closes the list, and a second Escape clears the box; Tab closes it without choosing.
// Focus stays in the input throughout; the highlighted option is announced via aria-activedescendant.

export interface LocationSearchProps {
  /** The place the current search is for (from the URL), shown until the person types. */
  initialLabel: string;
  onSelect: (suggestion: LocationSuggestionDto) => void;
}

export function LocationSearch({ initialLabel, onSelect }: LocationSearchProps) {
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${String(index)}`;

  const [value, setValue] = useState(initialLabel);
  /** True once the person has typed: until then the box shows the URL's place and nothing is fetched. */
  const [edited, setEdited] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /** The text as of the latest keystroke, for checking an Enter that waited on the network. */
  const latest = useRef(value);
  function setText(text: string) {
    latest.current = text;
    setValue(text);
  }

  const { status, suggestions, settle } = useSuggestions(edited ? value : null);
  const expanded = open && suggestions.length > 0;

  function choose(suggestion: LocationSuggestionDto) {
    setText(suggestion.label);
    setEdited(false);
    setOpen(false);
    setActive(-1);
    onSelect(suggestion);
  }

  /** Enter before the list has loaded: ask now, then take its first place if the text hasn't changed. */
  async function chooseFirstWhenReady() {
    const typed = value;
    const settled = await settle();
    const first = settled?.status === "ready" ? settled.suggestions[0] : undefined;
    if (first !== undefined && latest.current === typed) choose(first);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = suggestions.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (count === 0) return;
        setOpen(true);
        if (event.altKey) return;
        setActive((i) => (!expanded || i >= count - 1 ? 0 : i + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        if (count === 0) return;
        setOpen(true);
        setActive((i) => (!expanded || i <= 0 ? count - 1 : i - 1));
        return;
      case "Enter": {
        event.preventDefault();
        if (!edited) return;
        if (status === "loading") {
          void chooseFirstWhenReady();
          return;
        }
        const pick = suggestions[active] ?? suggestions[0];
        if (pick !== undefined) choose(pick);
        return;
      }
      case "Escape":
        if (expanded) {
          event.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (value !== "") {
          event.preventDefault();
          setText("");
          setEdited(true);
        }
        return;
      case "Tab":
        setOpen(false);
        setActive(-1);
        return;
      default:
        return;
    }
  }

  const message = !edited
    ? ""
    : status === "error"
      ? "Couldn't load places. Check your connection and try again."
      : status === "ready" && suggestions.length === 0
        ? "No matching places in Australia."
        : status === "ready"
          ? `${String(suggestions.length)} ${suggestions.length === 1 ? "place" : "places"} found. Use the up and down arrows to choose.`
          : "";

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">
        Search a suburb or place
      </label>
      <div className="flex min-h-12 items-center gap-2 rounded-pill border border-border-strong bg-surface px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
        <SearchIcon className="size-5 shrink-0 text-muted" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-describedby={`${id}-status`}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Search a suburb or place"
          maxLength={80}
          value={value}
          onChange={(event) => {
            setText(event.target.value);
            setEdited(true);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            if (edited) setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-ink placeholder:text-muted focus:outline-none"
        />
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Places"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-card border border-border bg-surface py-2 shadow-lg"
      >
        {suggestions.map((suggestion, index) => (
          // Options aren't focusable and take no keys by design (APG combobox): focus stays in the input,
          // which handles the keys and points at the highlighted option with aria-activedescendant.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- reason: APG combobox, keys handled by the input
          <div
            key={suggestion.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            // Keep focus in the input; the click then chooses.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              choose(suggestion);
            }}
            onMouseMove={() => {
              setActive(index);
            }}
            className={cx(
              "flex min-h-11 cursor-pointer flex-col justify-center px-4 py-2",
              index === active && "bg-subtle",
            )}
          >
            <span className="text-sm font-medium text-ink">{suggestion.name}</span>
            <span className="text-xs text-muted">{suggestion.label}</span>
          </div>
        ))}
      </div>

      {open && edited && (status === "error" || (status === "ready" && suggestions.length === 0)) ? (
        <p className="absolute inset-x-0 top-full z-20 mt-2 rounded-card border border-border bg-surface px-4 py-3 text-sm text-muted shadow-lg">
          {message}
        </p>
      ) : null}

      <p id={`${id}-status`} role="status" className="sr-only">
        {message}
      </p>
    </div>
  );
}
