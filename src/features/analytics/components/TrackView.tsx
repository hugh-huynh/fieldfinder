"use client";

import { useEffect, useRef } from "react";

import { track } from "../gtag";
import { takeSource } from "../source";

// view_venue / view_pitch (spec §7, PR 4.1), once per page shown, with where it was opened from.
// Renders nothing. Placed in the detail page, after the root layout's Analytics, so this page's page
// view goes first.

type Props = { kind: "venue"; venueId: string } | { kind: "pitch"; venueId: string; pitchId: string };

export function TrackView(props: Props) {
  const key = props.kind === "venue" ? props.venueId : `${props.venueId}/${props.pitchId}`;
  const sent = useRef<string | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    // Once per page, also under Strict Mode's double effects in development.
    if (sent.current === key) return;
    sent.current = key;
    const view = latest.current;
    const source = takeSource();
    if (view.kind === "venue") {
      track({ name: "view_venue", params: { venue_id: view.venueId, source } });
    } else {
      track({ name: "view_pitch", params: { venue_id: view.venueId, pitch_id: view.pitchId, source } });
    }
  }, [key]);

  return null;
}
