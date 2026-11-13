// Inline icons (no icon dependency). Decorative: always aria-hidden; the control carries the name.

type IconProps = { className?: string };

export function SearchIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

export function FiltersIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" strokeLinecap="round" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

/** The wordmark's mark: a pitch outline. Original artwork, decorative. */
export function PitchMark({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={className}>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" />
      <rect x="7" y="9" width="18" height="14" rx="1.5" fill="none" stroke="#fff" strokeWidth={1.75} />
      <path d="M16 9v14" stroke="#fff" strokeWidth={1.75} />
      <circle cx="16" cy="16" r="2.75" fill="none" stroke="#fff" strokeWidth={1.75} />
    </svg>
  );
}
