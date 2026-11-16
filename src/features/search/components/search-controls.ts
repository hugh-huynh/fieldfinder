"use client";

// Lets the results panel hand the person to the header's controls (PR 3.3): "Search another area"
// moves focus to the location search, and "Edit filters" to the Filters button. Both live in the
// header's search landmark (AppHeader), which is on every page. When the Filters dialog lands
// (3.7), editFilters() opens it instead of focusing the button.

export function focusLocationSearch(): void {
  const input = document.querySelector<HTMLInputElement>('[role="search"] input[role="combobox"]');
  input?.focus();
  input?.select();
}

export function editFilters(): void {
  document.querySelector<HTMLButtonElement>('[role="search"] button[aria-haspopup="dialog"]')?.focus();
}
