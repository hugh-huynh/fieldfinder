"use client";

import { useId } from "react";

import { setConsent, useConsent } from "../consent";
import { measurementId } from "../gtag";

// The analytics setting on /privacy (PR 4.1): the same choice as the banner, changeable at any time.
// A native radio group, so it's one Tab stop with arrow keys between the two options. Turning
// analytics off stops it at once and removes its cookies (Analytics.tsx).

export function AnalyticsChoice() {
  const consent = useConsent();
  const name = useId();
  const statusId = useId();

  if (measurementId() === null) {
    return (
      <p className="text-muted">Analytics isn&rsquo;t switched on for this site, so there&rsquo;s nothing to choose.</p>
    );
  }
  if (consent === "pending") return <p className="text-muted">Loading your choice…</p>;

  const status =
    consent === "granted"
      ? "Analytics is on for this browser."
      : consent === "denied"
        ? "Analytics is off for this browser."
        : "You haven’t chosen yet, so analytics is off.";

  return (
    <fieldset aria-describedby={statusId} className="rounded-card border border-border p-4">
      <legend className="px-1 font-semibold text-ink">Google Analytics in this browser</legend>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-6">
        {(
          [
            ["granted", "Allow analytics"],
            ["denied", "Don’t allow"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-10 cursor-pointer items-center gap-2 text-ink">
            <input
              type="radio"
              name={name}
              value={value}
              checked={consent === value}
              onChange={() => {
                setConsent(value);
              }}
              className="size-5 accent-primary"
            />
            {label}
          </label>
        ))}
      </div>
      <p id={statusId} role="status" className="mt-2 text-sm text-muted">
        {status}
      </p>
    </fieldset>
  );
}
