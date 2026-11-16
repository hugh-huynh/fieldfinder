import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { flushSavedView } from "@/features/search/history-state";

afterEach(() => {
  cleanup();
  // The search page saves where the person was in history.state (PR 3.6). Write anything pending now,
  // then start the next test on a clean history entry, so no saved view leaks between tests.
  flushSavedView();
  window.history.replaceState(null, "", "/");
});
