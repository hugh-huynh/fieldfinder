"use client";

import Image from "next/image";

// A published photo from the media bucket (PR 3.12). Served as stored: the upload pipeline's WebP,
// capped at 2560 px (PR 2.12). Not resized by Next.js or Vercel: an optimiser's cache can keep
// serving a photo after it's unpublished (Next keeps its last good copy when re-fetching a deleted
// original fails), and unpublished photos must stop being reachable (ADR-0006; Hugh, 2026-11-17).
// Smaller copies made at upload, each removed on unpublish, are the planned follow-up for srcset.
//
// The caller sizes the box (fixed aspect ratio and a background), so nothing shifts while it loads
// (CLS), and a failure leaves the box in place.

export interface MediaImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** How wide the image is shown, e.g. "(min-width: 640px) 176px, 128px" (for srcset once there are sizes). */
  sizes: string;
  priority?: boolean;
  className?: string;
  onError?: () => void;
}

export function MediaImage({ src, alt, width, height, sizes, priority = false, className, onError }: MediaImageProps) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      unoptimized
      priority={priority}
      loading={priority ? undefined : "lazy"}
      onError={onError}
      className={className}
    />
  );
}
