import { cx } from "@/lib/cx";

/** Decorative loading placeholder; pair with a visually hidden status message for screen readers. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-card bg-subtle", className)} />;
}
