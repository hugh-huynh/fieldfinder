import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Pill } from "@/components/ui/Pill";
import { ACCESS_LABELS } from "@/features/search/format";
import { BackToResults } from "@/features/venues/components/BackToResults";
import { FacilityList } from "@/features/venues/components/FacilityList";
import { Gallery } from "@/features/venues/components/Gallery";
import { PitchCard } from "@/features/venues/components/PitchCard";
import { VenueLocation } from "@/features/venues/components/VenueLocation";
import { TrackView } from "@/features/analytics/components/TrackView";
import { getVenueDetail } from "@/features/venues/detail";
import { slugSchema } from "@/features/venues/slug";
import { publicDb } from "@/lib/db/public";

// `/venues/[venueSlug]` (spec §3 details, PR 3.10): a published venue with its photos, pitches,
// facilities, location and a directions link. Server-rendered from the published-only views as
// ff_public_reader (ADR-0002), so a draft, archived or pitch-less venue is simply absent: notFound()
// without saying why. Search links here for a venue with several published pitches; a single-pitch
// venue's search link goes to its pitch page (3.11), but this page works for it too.
//
// Rendered on demand and cached for at most 60 s, like GET /api/venues/[venueSlug]: an unpublished
// venue disappears within a minute, and nothing is built at deploy time (spec §4: no unpublished
// content in static HTML).

export const revalidate = 60;

type Params = Promise<{ venueSlug: string }>;

/** One lookup per request, shared by the metadata and the page. */
const load = cache(async (venueSlug: string) => {
  const slug = slugSchema.safeParse(venueSlug);
  if (!slug.success) return null;
  return getVenueDetail(publicDb(), slug.data);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const detail = await load((await params).venueSlug);
  if (detail === null) return { title: "Not found · FieldFinder" };
  const { venue } = detail;
  const pitches = `${String(venue.publishedPitchCount)} ${venue.publishedPitchCount === 1 ? "pitch" : "pitches"}`;
  return {
    title: `${venue.name}, ${venue.suburb} · FieldFinder`,
    description: `${venue.name} in ${venue.suburb} ${venue.state}: ${pitches}, facilities and directions.`,
  };
}

export default async function VenuePage({ params }: { params: Params }) {
  const detail = await load((await params).venueSlug);
  if (detail === null) notFound();
  const { venue, pitches, media } = detail;

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 pt-4 pb-16 lg:px-6">
        <TrackView kind="venue" venueId={venue.id} />
        <BackToResults />

        <header className="mt-2">
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{venue.name}</h1>
          <p className="mt-1 text-muted">
            {venue.suburb}, {venue.state}
          </p>
          <ul aria-label="At a glance" className="mt-3 flex flex-wrap gap-1.5">
            <li>
              <Pill tone="brand">
                {venue.publishedPitchCount} {venue.publishedPitchCount === 1 ? "pitch" : "pitches"}
              </Pill>
            </li>
            {venue.access === null ? null : (
              <li>
                <Pill>{ACCESS_LABELS[venue.access]}</Pill>
              </li>
            )}
          </ul>
        </header>

        <div className="mt-6">
          <Gallery media={media} label={venue.name} />
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-10">
            {venue.description === null ? null : (
              <section aria-labelledby="about">
                <h2 id="about" className="text-lg font-semibold text-ink">
                  About
                </h2>
                <p className="mt-2 whitespace-pre-line text-ink">{venue.description}</p>
              </section>
            )}

            <section aria-labelledby="pitches">
              <h2 id="pitches" className="text-lg font-semibold text-ink">
                Pitches
              </h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {pitches.map((pitch) => (
                  <li key={pitch.id}>
                    <PitchCard pitch={pitch} />
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="facilities">
              <h2 id="facilities" className="text-lg font-semibold text-ink">
                Facilities
              </h2>
              <div className="mt-3 max-w-sm">
                <FacilityList amenities={venue.amenities} />
              </div>
            </section>
          </div>

          <aside aria-labelledby="location" className="lg:pt-0">
            <h2 id="location" className="text-lg font-semibold text-ink">
              Location
            </h2>
            <VenueLocation venue={venue} />

            <h2 className="mt-8 text-lg font-semibold text-ink">Access</h2>
            <p className="mt-2 text-ink">{venue.access === null ? "Not confirmed" : ACCESS_LABELS[venue.access]}</p>
            <p className="mt-1 text-sm text-muted">Pitches may have their own rules; see each pitch.</p>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
