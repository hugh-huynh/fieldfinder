"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { setConsent, useConsent } from "../consent";
import { parseEvent } from "../events";
import { measurementId, sendPageView, startAnalytics, stopAnalytics, track } from "../gtag";
import { sanitisePageLocation, sanitiseReferrer } from "../page-location";
import { noteSource } from "../source";

import { ConsentBanner } from "./ConsentBanner";

// GA4 for the whole app (PR 4.1), mounted once in the root layout BEFORE the page, so on every
// navigation its page view is sent before the new page's own events (effects run in tree order).
// - Nothing loads until the person allows analytics (opt-in); "No thanks" or a later change on
//   /privacy stops it and removes its cookies. No measurement id configured: no banner, nothing.
// - One page view per page: sent when the sanitised location changes (page-location.ts). A new
//   search on `/` with the same filters is the same page; it's counted by the search events instead.
// - Clicks on marked links (data-analytics-*) note where a detail page was opened from, and send
//   click_directions, without each link needing client code.

export function Analytics() {
  const id = measurementId();
  const consent = useConsent();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    if (consent === "denied") {
      stopAnalytics(id);
      lastSent.current = null;
      return;
    }
    if (consent !== "granted") return;
    const location = sanitisePageLocation(window.location.href);
    if (location === null) return;
    startAnalytics(id, location, sanitiseReferrer(document.referrer, window.location.origin));
    if (lastSent.current === location) return;
    if (sendPageView(location, document.title)) lastSent.current = location;
  }, [id, consent, pathname, query]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const sourced = target?.closest<HTMLElement>("[data-analytics-source]");
      if (sourced) noteSource(sourced.dataset.analyticsSource);
      const marked = target?.closest<HTMLElement>("[data-analytics-event]");
      if (marked?.dataset.analyticsEvent === "click_directions") {
        const { venueId, pitchId } = marked.dataset;
        const parsed = parseEvent("click_directions", {
          venue_id: venueId,
          ...(pitchId === undefined ? {} : { pitch_id: pitchId }),
        });
        if (parsed !== null) track(parsed);
      }
    }
    // Capture: noted before the link's own navigation handling runs.
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  if (id === null || consent !== "unset") return null;
  return (
    <ConsentBanner
      onAllow={() => {
        setConsent("granted");
      }}
      onDecline={() => {
        setConsent("denied");
      }}
    />
  );
}
