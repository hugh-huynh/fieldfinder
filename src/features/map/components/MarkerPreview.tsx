"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { VenueSearchResultDto } from "@/features/search/search";
import { formatDistance, pitchCountLabel } from "@/features/search/format";
import { PitchMark } from "@/features/search/components/icons";

// The second step of choosing on the map (spec §1 and §3, PR 3.5). Choosing a marker opens this
// preview and moves focus to it; only activating the preview navigates. It goes to the venue's
// `href`: the pitch page for a venue with one published pitch, else the venue page. That comes from
// venueRouteTarget() on the server, from published pitches only, so filters never change it.
//
// A non-modal dialog over the top of the map: the person can still use the map and the list. Escape
// or Close shuts it and puts focus back on the marker (the parent does that in onClose).

export function MarkerPreview({ venue, onClose }: { venue: VenueSearchResultDto; onClose: () => void }) {
  const titleId = useId();
  const link = useRef<HTMLAnchorElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const image = venue.image !== null && venue.image.url !== failedUrl ? venue.image : null;

  // Keyed by venue in the parent, so this runs each time a marker is chosen.
  useEffect(() => {
    link.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    // Escape-to-close on the dialog itself is the APG dialog pattern; the dialog takes no other keys.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- reason: APG dialog, Escape closes
    <div
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className="group absolute inset-x-4 top-4 z-20 flex items-center gap-3 rounded-card border border-border bg-surface p-2 pr-12 shadow-lg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus sm:right-auto sm:w-96"
    >
      <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-card bg-subtle">
        {image === null ? (
          <div className="flex size-full items-center justify-center">
            <PitchMark className="size-8 text-border-strong" />
          </div>
        ) : (
          <Image
            src={image.url}
            alt={image.alt}
            width={image.width}
            height={image.height}
            unoptimized
            onError={() => {
              setFailedUrl(image.url);
            }}
            className="size-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p id={titleId} className="text-sm leading-snug font-semibold text-ink">
          {/* The whole card opens the destination: the name is the one link, stretched over it. */}
          <Link
            ref={link}
            href={venue.href}
            className="rounded-sm group-focus-within:underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none"
          >
            {venue.name}
          </Link>
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {pitchCountLabel(venue.publishedPitchCount, venue.matchingPitchCount)} ·{" "}
          {formatDistance(venue.distanceMeters)}
        </p>
      </div>
      {/* Above the stretched link, so it closes rather than navigates. */}
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute top-1/2 right-2 z-10 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-pill text-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="size-5"
        >
          <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
