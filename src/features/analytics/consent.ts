import { useSyncExternalStore } from "react";

// Analytics consent (PR 4.1, opt-in): GA4 loads only after the person presses "Allow analytics".
// The choice is kept in this browser's localStorage (it's the one thing analytics consent needs to
// remember) and can be changed on /privacy. No choice yet, or storage that can't be read (private
// mode, blocked site data), means no analytics.

export type Consent = "granted" | "denied";
export type ConsentState = Consent | "unset";

export const CONSENT_STORAGE_KEY = "ff.analytics-consent";

const listeners = new Set<() => void>();
/** The choice made in this page, for when storage can't keep it. */
let inMemory: Consent | null = null;

function read(): ConsentState {
  try {
    const stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (stored === "granted" || stored === "denied") return stored;
  } catch {
    // Storage blocked: fall back to this page's choice, if any.
  }
  return inMemory ?? "unset";
}

export function getConsent(): ConsentState {
  return typeof window === "undefined" ? "unset" : read();
}

export function setConsent(consent: Consent): void {
  inMemory = consent;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, consent);
  } catch {
    // Kept for this page only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing the choice applies here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The current choice, or "pending" on the server and while hydrating: the banner waits for the real
 * answer, so it never flashes for someone who has already chosen.
 */
export function useConsent(): ConsentState | "pending" {
  return useSyncExternalStore<ConsentState | "pending">(subscribe, getConsent, () => "pending");
}

/** For tests: forget the in-page choice. */
export function resetConsentForTests(): void {
  inMemory = null;
}
