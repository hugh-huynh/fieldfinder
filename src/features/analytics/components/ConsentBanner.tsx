import Link from "next/link";
import { useId, useLayoutEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";

// The analytics consent banner (PR 4.1, opt-in). It sits in the page above the header, never over
// it: nothing it covers can be hidden behind it (WCAG 2.2 Focus Not Obscured), and it scrolls away
// with the page. It stays until the person chooses; the choice can be changed on /privacy.
// Its height is published as --consent-h, so the search page (sized to the screen) makes room for it
// rather than running off the bottom.

export function ConsentBanner({ onAllow, onDecline }: { onAllow: () => void; onDecline: () => void }) {
  const titleId = useId();
  const region = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = region.current;
    if (element === null) return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty("--consent-h", `${String(Math.ceil(element.getBoundingClientRect().height))}px`);
    };
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--consent-h");
    };
  }, []);

  return (
    <section ref={region} aria-labelledby={titleId} className="border-b border-border bg-subtle">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center lg:px-6">
        <div className="text-sm text-ink sm:flex-1">
          <h2 id={titleId} className="font-semibold">
            Help us improve FieldFinder?
          </h2>
          <p className="mt-0.5 text-muted">
            With your OK, we use Google Analytics to count which pages and searches are used. It never gets your exact
            location or what you type.{" "}
            <Link href="/privacy" className="font-semibold text-primary underline underline-offset-2">
              How we handle data
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button onClick={onAllow}>Allow analytics</Button>
          <Button variant="secondary" onClick={onDecline}>
            No thanks
          </Button>
        </div>
      </div>
    </section>
  );
}
