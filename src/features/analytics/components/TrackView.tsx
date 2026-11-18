"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { analyticsActive, subscribeAnalytics, track } from "../gtag";
import { takeSource } from "../source";

// view_venue / view_pitch (spec §7, PR 4.1), once per page shown, with where it was opened from.
// Renders nothing. Placed in the detail page, after the root layout's Analytics, so this page's page
// view goes first.
// On a load with consent already given, this page's first effects run while consent is still
// hydrating and analytics hasn't started: the view waits until it has, and counts as sent only once
// it was.

type Props = { kind: "venue"; venueId: string } | { kind: "pitch"; venueId: string; pitchId: string };

export function TrackView(props: Props) {
  const key = props.kind === "venue" ? props.venueId : `${props.venueId}/${props.pitchId}`;
  const ready = useSyncExternalStore(subscribeAnalytics, analyticsActive, () => false);
  const sent = useRef<string | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    // Once per page, also under Strict Mode's double effects in development.
    if (!ready || sent.current === key) return;
    const view = latest.current;
    const source = takeSource();
    const ok =
      view.kind === "venue"
        ? track({ name: "view_venue", params: { venue_id: view.venueId, source } })
        : track({ name: "view_pitch", params: { venue_id: view.venueId, pitch_id: view.pitchId, source } });
    if (ok) sent.current = key;
  }, [key, ready]);

  return null;
}
