"use client";

// Lets the results panel hand the person to the header's controls (PR 3.3): "Search another area"
// moves focus to the location search, and "Edit filters" to the Filters button. Both live in the
// header's search landmark (AppHeader), which is on every page. "Edit filters" presses the Filters
// button, opening the dialog (3.7); closing it puts focus back on "Edit filters".

export function focusLocationSearch(): void {
  const input = document.querySelector<HTMLInputElement>('[role="search"] input[role="combobox"]');
  input?.focus();
  input?.select();
}

export function editFilters(event?: { currentTarget: HTMLElement }): void {
  // Safari doesn't focus a clicked button: focus it, so closing the dialog returns here.
  event?.currentTarget.focus();
  document.querySelector<HTMLButtonElement>('[role="search"] button[aria-haspopup="dialog"]')?.click();
}
