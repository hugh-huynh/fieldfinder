import { type ComponentPropsWithRef } from "react";
import { cx } from "@/lib/cx";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: Variant;
  size?: Size;
};

const variants: Record<Variant, string> = {
  primary: "bg-primary text-surface hover:bg-primary-dark disabled:bg-muted",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-subtle disabled:text-muted",
  ghost: "bg-transparent text-primary hover:bg-subtle disabled:text-muted",
};

const sizes: Record<Size, string> = {
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-6 text-base",
};

export function Button({ variant = "primary", size = "md", type = "button", className, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition-colors disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
