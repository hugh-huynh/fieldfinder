"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Pill } from "@/components/ui/Pill";
import type { VenueSearchResultDto } from "@/features/search/search";

import { AMENITY_LABELS, availableAmenities, formatDistance, pitchCountLabel, pitchSummaryLabels } from "../format";

import { PitchMark } from "./icons";

// One venue in the results (spec §3, PR 3.3): photo, name, suburb, distance, pitch counts, what its
// published pitches have, and the facilities confirmed as available. Unconfirmed facts are left out,
// never shown as "no" (CLAUDE.md rule 4). The whole card opens `href` (a single-pitch venue goes
// straight to its pitch page); the name is the one link, stretched over the card, so screen readers
// hear one link per venue. No ratings, prices, availability or save button (rule 4). A photo that
// fails to load (e.g. unpublished while the page was open) falls back to the placeholder.

export function VenueCard({ venue, headingLevel = 2 }: { venue: VenueSearchResultDto; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const facts = pitchSummaryLabels(venue.pitchSummary);
  const facilities = availableAmenities(venue.amenities);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const image = venue.image !== null && venue.image.url !== failedUrl ? venue.image : null;

  return (
    <article className="group relative flex gap-4 rounded-card p-2 transition-colors focus-within:bg-subtle hover:bg-subtle">
      <div className="relative aspect-[4/3] w-32 shrink-0 self-start overflow-hidden rounded-card bg-subtle sm:w-44">
        {image === null ? (
          <div className="flex size-full items-center justify-center" data-testid="image-placeholder">
            <PitchMark className="size-10 text-border-strong" />
          </div>
        ) : (
          // Unoptimised: images are already resized WebP/AVIF from the media pipeline (PR 2.12).
          <Image
            src={image.url}
            alt={image.alt}
            width={image.width}
            height={image.height}
            unoptimized
            loading="lazy"
            onError={() => {
              setFailedUrl(image.url);
            }}
            className="size-full object-cover"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
        <Heading className="text-base leading-snug font-semibold text-ink">
          <Link
            href={venue.href}
            className="rounded-sm group-focus-within:underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none"
          >
            {venue.name}
          </Link>
        </Heading>
        <p className="text-sm text-muted">
          {venue.suburb} · {formatDistance(venue.distanceMeters)}
        </p>

        <ul aria-label="Pitches" className="mt-1 flex flex-wrap gap-1.5">
          <li>
            <Pill tone="brand">{pitchCountLabel(venue.publishedPitchCount, venue.matchingPitchCount)}</Pill>
          </li>
          {facts.map((fact) => (
            <li key={fact}>
              <Pill>{fact}</Pill>
            </li>
          ))}
        </ul>

        {facilities.length > 0 ? (
          <ul aria-label="Facilities" className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            {facilities.map((key) => (
              <li key={key}>{AMENITY_LABELS[key]}</li>
            ))}
          </ul>
        ) : null}

        {image?.attribution ? (
          <p className="mt-auto pt-1 text-[0.6875rem] text-muted">Photo: {image.attribution.text}</p>
        ) : null}
      </div>
    </article>
  );
}
