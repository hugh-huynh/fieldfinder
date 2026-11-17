"use client";

import Image from "next/image";

// A published photo from the media bucket (PR 3.12). With image optimisation on (next.config.ts),
// Next.js builds a srcset from `sizes` and serves resized AVIF/WebP; otherwise the stored WebP as is
// (already capped at 2560 px by the upload pipeline, PR 2.12). The caller sizes the box (fixed aspect
// ratio and a background), so nothing shifts while it loads (CLS) and a failure leaves the box.

export interface MediaImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** How wide the image is shown, for srcset, e.g. "(min-width: 640px) 176px, 128px". */
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
      unoptimized={process.env.NEXT_PUBLIC_MEDIA_OPTIMIZED !== "1"}
      priority={priority}
      loading={priority ? undefined : "lazy"}
      onError={onError}
      className={className}
    />
  );
}
