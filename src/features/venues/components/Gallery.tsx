"use client";

import { useEffect, useRef, useState } from "react";

import { MediaImage } from "@/features/media/components/MediaImage";
import { PitchMark } from "@/features/search/components/icons";
import { creditLine } from "@/features/search/format";

import type { MediaDto } from "../dto";

// A venue's or pitch's published photos (PRs 3.10, 3.12): the first large, the rest as a row of
// thumbnails, each with its credit when the licence needs one (ADR-0006).
//
// - Every photo sits in a fixed-ratio box with a solid placeholder colour (Hugh: no blur data), so
//   nothing shifts as photos load (CLS), and a photo that fails to load (e.g. unpublished while the
//   page was open) is replaced by a placeholder in the same box rather than collapsing the layout.
// - Each photo is a button that opens the lightbox: a modal <dialog> with the photo, its description
//   and credit, "Photo 2 of 5", Previous/Next buttons and the arrow keys (wrapping at the ends).
//   Escape or Close returns focus to the thumbnail of the photo last shown.
// - Photos are served as stored, not resized (see MediaImage: an optimiser cache could outlive
//   unpublishing). `sizes` is set for when upload-time copies give a srcset.

const SIZES = {
  large: "(min-width: 1024px) 976px, calc(100vw - 2rem)",
  thumb: "(min-width: 640px) 240px, 33vw",
  lightbox: "100vw",
} as const;

export function Gallery({ media, label }: { media: readonly MediaDto[]; label: string }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const markFailed = (id: string) => {
    setFailed((current) => new Set(current).add(id));
  };

  if (media.length === 0) {
    return (
      <div
        className="flex h-32 w-full items-center justify-center rounded-card bg-subtle sm:h-40"
        data-testid="gallery-placeholder"
      >
        <PitchMark className="size-14 text-border-strong" />
        <span className="sr-only">No photos of {label} yet</span>
      </div>
    );
  }

  const tile = (item: MediaDto, index: number, large: boolean) => (
    <figure>
      <button
        type="button"
        ref={(element) => {
          tiles.current[index] = element;
        }}
        aria-haspopup="dialog"
        aria-label={`Open photo ${String(index + 1)} of ${String(media.length)}: ${item.alt}`}
        onClick={() => {
          setOpen(index);
        }}
        className={`block w-full overflow-hidden rounded-card bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
          large ? "aspect-[16/9] sm:aspect-[21/9]" : "aspect-[4/3]"
        }`}
      >
        {failed.has(item.id) ? (
          <Unavailable />
        ) : (
          <MediaImage
            src={item.url}
            alt={item.alt}
            width={item.width}
            height={item.height}
            sizes={large ? SIZES.large : SIZES.thumb}
            priority={large}
            onError={() => {
              markFailed(item.id);
            }}
            className="size-full object-cover transition-transform hover:scale-[1.02] motion-reduce:transition-none"
          />
        )}
      </button>
      {item.attribution === null ? null : (
        <figcaption className="mt-1 text-[0.6875rem] break-words text-muted">
          {creditLine(item.attribution.text)}
        </figcaption>
      )}
    </figure>
  );

  const [first, ...rest] = media;
  return (
    <section aria-label={`Photos of ${label}`}>
      {first === undefined ? null : tile(first, 0, true)}
      {rest.length > 0 ? (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {rest.map((item, i) => (
            <li key={item.id}>{tile(item, i + 1, false)}</li>
          ))}
        </ul>
      ) : null}
      {open === null ? null : (
        <Lightbox
          media={media}
          index={open}
          failed={failed}
          onFailed={markFailed}
          onIndex={setOpen}
          onClose={() => {
            const from = open;
            setOpen(null);
            tiles.current[from]?.focus();
          }}
        />
      )}
    </section>
  );
}

function Unavailable() {
  return (
    <span className="flex size-full items-center justify-center">
      <PitchMark className="size-10 text-border-strong" />
      <span className="sr-only">Photo unavailable</span>
    </span>
  );
}

function Lightbox({
  media,
  index,
  failed,
  onFailed,
  onIndex,
  onClose,
}: {
  media: readonly MediaDto[];
  index: number;
  failed: ReadonlySet<string>;
  onFailed: (id: string) => void;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const item = media[index];
  const count = media.length;
  const step = (by: number) => {
    onIndex((index + by + count) % count);
  };
  /** Close the native dialog first: while it's open the page is inert and can't take focus back. */
  const close = () => {
    dialog.current?.close();
    onClose();
  };

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    // Browsers differ on what a modal focuses first: put focus on Close, so the keys work at once.
    closeButton.current?.focus();
  }, []);

  // The keys work wherever focus is while the viewer is open: Safari's Tab skips buttons by default,
  // so focus may have left the dialog's controls (the page behind is inert, so nothing else uses them).
  const onKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    onKey.current = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowRight" && count > 1) {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft" && count > 1) {
        event.preventDefault();
        step(-1);
      }
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      onKey.current(event);
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
    };
  }, []);

  if (item === undefined) return null;
  return (
    <dialog
      ref={dialog}
      aria-label={`Photo ${String(index + 1)} of ${String(count)}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-ink p-0 text-surface backdrop:bg-ink"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-4 py-3">
          <p aria-live="polite" className="text-sm font-medium">
            Photo {index + 1} of {count}
          </p>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close photos"
            onClick={close}
            className="inline-flex size-11 items-center justify-center rounded-pill hover:bg-surface/10 focus-visible:outline-2 focus-visible:outline-surface"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="size-6"
            >
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
          {failed.has(item.id) ? (
            <div className="flex aspect-[4/3] w-full max-w-3xl items-center justify-center rounded-card bg-surface/10">
              <PitchMark className="size-14 text-surface/60" />
              <span className="sr-only">Photo unavailable</span>
            </div>
          ) : (
            <MediaImage
              key={item.id}
              src={item.url}
              alt={item.alt}
              width={item.width}
              height={item.height}
              sizes={SIZES.lightbox}
              onError={() => {
                onFailed(item.id);
              }}
              className="max-h-full w-auto max-w-full object-contain"
            />
          )}
          {count > 1 ? (
            <>
              <StepButton
                label="Previous photo"
                side="left"
                onClick={() => {
                  step(-1);
                }}
              />
              <StepButton
                label="Next photo"
                side="right"
                onClick={() => {
                  step(1);
                }}
              />
            </>
          ) : null}
        </div>

        <div className="px-4 py-3 text-center text-sm">
          <p>{item.alt}</p>
          {item.attribution === null ? null : (
            <p className="mt-1 text-xs text-surface/80">{creditLine(item.attribution.text)}</p>
          )}
        </div>
      </div>
    </dialog>
  );
}

function StepButton({ label, side, onClick }: { label: string; side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-pill bg-ink/60 hover:bg-ink/80 focus-visible:outline-2 focus-visible:outline-surface ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-6">
        <path d={side === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
