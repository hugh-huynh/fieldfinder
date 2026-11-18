import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { resetConsentForTests } from "@/features/analytics/consent";
import { resetAnalyticsForTests } from "@/features/analytics/gtag";
import { flushSavedView } from "@/features/search/history-state";

// jsdom has no showModal()/close() on <dialog> (PR 3.7). This stand-in only toggles `open` and fires
// "close": it doesn't trap focus or make the page inert. Real-browser behaviour is covered by E2E.
if (typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

afterEach(() => {
  cleanup();
  // The search page saves where the person was in history.state (PR 3.6). Write anything pending now,
  // then start the next test on a clean history entry, so no saved view leaks between tests.
  flushSavedView();
  window.history.replaceState(null, "", "/");
  // Analytics (PR 4.1): no consent, nothing running, an empty data layer and no gtag script.
  resetAnalyticsForTests();
  resetConsentForTests();
  window.localStorage.clear();
  delete window.dataLayer;
  delete window.gtag;
  for (const script of document.querySelectorAll("script[data-ff-gtag]")) script.remove();
});
