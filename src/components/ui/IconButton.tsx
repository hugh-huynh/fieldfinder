import { type ComponentPropsWithRef, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export type IconButtonProps = Omit<ComponentPropsWithRef<"button">, "children" | "aria-label"> & {
  /** Accessible name; required because the button has no visible text. */
  label: string;
  icon: ReactNode;
};

export function IconButton({ label, icon, type = "button", className, ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(
        "inline-flex size-10 items-center justify-center rounded-pill border border-border-strong bg-surface text-ink transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:text-muted",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </button>
  );
}
