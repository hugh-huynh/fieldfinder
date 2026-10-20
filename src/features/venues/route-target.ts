// Where a venue card or marker preview links to (spec §2–3, CLAUDE.md rule 6, PR 2.8): a venue with
// exactly one published pitch goes straight to that pitch's page; any other venue goes to its venue
// page. How many pitches match the current filters never changes this. Both pages also work as
// direct deep links whatever the count.

export function venuePath(venueSlug: string): string {
  return `/venues/${encodeURIComponent(venueSlug)}`;
}

export function pitchPath(venueSlug: string, pitchSlug: string): string {
  return `${venuePath(venueSlug)}/pitches/${encodeURIComponent(pitchSlug)}`;
}

/** `publishedPitchSlugs` must list the venue's published pitches only, never drafts or archived ones. */
export function venueRouteTarget(venueSlug: string, publishedPitchSlugs: readonly string[]): string {
  const [only, ...rest] = publishedPitchSlugs;
  return only !== undefined && rest.length === 0 ? pitchPath(venueSlug, only) : venuePath(venueSlug);
}
