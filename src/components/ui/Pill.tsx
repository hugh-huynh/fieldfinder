import { type ReactNode } from "react";
import { cx } from "@/lib/cx";

type Tone = "brand" | "neutral";

const tones: Record<Tone, string> = {
  brand: "bg-subtle text-primary",
  neutral: "border border-border bg-surface text-ink",
};

/** Non-interactive label for pitch characteristics and counts (e.g. "4 pitches", "Synthetic"). */
export function Pill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex items-center rounded-pill px-3 py-1 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}
