"use client";

import Image from "next/image";
import { useState } from "react";

import { PitchMark } from "@/features/search/components/icons";

import type { MediaDto } from "../dto";

// A venue's or pitch's published photos (PR 3.10): the first large, the rest as a row beneath. Each
// photo's credit is shown under it when its licence needs one (ADR-0006). A photo that fails to load
// (e.g. unpublished while the page was open) is dropped. No photos: a placeholder, never a stock
// image. Responsive sizes and a keyboard lightbox come in 3.12.

export function Gallery({ media, label }: { media: readonly MediaDto[]; label: string }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const shown = media.filter((item) => !failed.has(item.id));
  const drop = (id: string) => {
    setFailed((current) => new Set(current).add(id));
  };

  if (shown.length === 0) {
    return (
      <div
        // A short band: an empty photo area shouldn't push the venue's details down the page.
        className="flex h-32 w-full items-center justify-center rounded-card bg-subtle sm:h-40"
        data-testid="gallery-placeholder"
      >
        <PitchMark className="size-14 text-border-strong" />
        <span className="sr-only">No photos of {label} yet</span>
      </div>
    );
  }

  const [first, ...rest] = shown;
  return (
    <section aria-label={`Photos of ${label}`}>
      {first === undefined ? null : <Photo item={first} large onError={drop} />}
      {rest.length > 0 ? (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {rest.map((item) => (
            <li key={item.id}>
              <Photo item={item} onError={drop} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Photo({ item, large = false, onError }: { item: MediaDto; large?: boolean; onError: (id: string) => void }) {
  return (
    <figure>
      <div
        className={
          large
            ? "aspect-[16/9] overflow-hidden rounded-card bg-subtle sm:aspect-[21/9]"
            : "aspect-[4/3] overflow-hidden rounded-card bg-subtle"
        }
      >
        {/* Unoptimised: images are already resized WebP/AVIF from the media pipeline (PR 2.12). */}
        <Image
          src={item.url}
          alt={item.alt}
          width={item.width}
          height={item.height}
          unoptimized
          priority={large}
          onError={() => {
            onError(item.id);
          }}
          className="size-full object-cover"
        />
      </div>
      {item.attribution === null ? null : (
        <figcaption className="mt-1 text-[0.6875rem] break-words text-muted">Photo: {item.attribution.text}</figcaption>
      )}
    </figure>
  );
}
