import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { notFound } from "next/navigation";
import { cache } from "react";

import { BackToResults } from "@/features/venues/components/BackToResults";
import { FacilityList } from "@/features/venues/components/FacilityList";
import { Gallery } from "@/features/venues/components/Gallery";
import { VenueLocation } from "@/features/venues/components/VenueLocation";
import { TrackView } from "@/features/analytics/components/TrackView";
import { getPitchDetail } from "@/features/venues/detail";
import { pitchSpecs } from "@/features/venues/pitch-specs";
import { venuePath } from "@/features/venues/route-target";
import { slugSchema } from "@/features/venues/slug";
import { publicDb } from "@/lib/db/public";

// `/venues/[venueSlug]/pitches/[pitchSlug]` (spec §3 details, PR 3.11): one published pitch with its
// specs ("Not confirmed" where unknown), its photos then its venue's, the venue's shared facilities,
// access rules, address and directions. Search links here directly for a venue with one published
// pitch (spec §1); a link to the venue page is always there too.
//
// As the venue page (3.10): read from the published-only views as ff_public_reader; a draft or
// archived pitch, a pitch under an unpublished venue and malformed slugs are notFound() without
// saying why; rendered on demand, cached for at most 60 s.

export const revalidate = 60;

type Params = Promise<{ venueSlug: string; pitchSlug: string }>;

const load = cache(async (venueSlug: string, pitchSlug: string) => {
  const venue = slugSchema.safeParse(venueSlug);
  const pitch = slugSchema.safeParse(pitchSlug);
  if (!venue.success || !pitch.success) return null;
  return getPitchDetail(publicDb(), venue.data, pitch.data);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { venueSlug, pitchSlug } = await params;
  const detail = await load(venueSlug, pitchSlug);
  if (detail === null) return { title: "Not found · FieldFinder" };
  const { pitch, venue } = detail;
  return {
    title: `${pitch.name} at ${venue.name}, ${venue.suburb} · FieldFinder`,
    description: `${pitch.name} at ${venue.name} in ${venue.suburb} ${venue.state}: pitch specs, facilities and directions.`,
  };
}

export default async function PitchPage({ params }: { params: Params }) {
  const { venueSlug, pitchSlug } = await params;
  const detail = await load(venueSlug, pitchSlug);
  if (detail === null) notFound();
  const { pitch, venue, media, venueMedia } = detail;
  // The pitch's own photos first, then the venue's (never the same image twice).
  const pitchIds = new Set(media.map((item) => item.id));
  const photos = [...media, ...venueMedia.filter((item) => !pitchIds.has(item.id))];

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 pt-4 pb-16 lg:px-6">
        <TrackView kind="pitch" venueId={venue.id} pitchId={pitch.id} />
        <BackToResults />

        <header className="mt-2">
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{pitch.name}</h1>
          <p className="mt-1 text-muted">
            At{" "}
            <Link
              href={venuePath(venue.slug)}
              className="font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {venue.name}
            </Link>
            , {venue.suburb}, {venue.state}
          </p>
        </header>

        <div className="mt-6">
          <Gallery media={photos} label={`${pitch.name} at ${venue.name}`} />
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-10">
            <section aria-labelledby="specs">
              <h2 id="specs" className="text-lg font-semibold text-ink">
                Pitch details
              </h2>
              <dl className="mt-3 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                {pitchSpecs(pitch).map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-muted">{row.label}</dt>
                    <dd className={row.value === "Not confirmed" ? "text-muted" : "font-medium text-ink"}>
                      {row.value}
                      {row.note === undefined ? null : <span className="font-normal text-muted"> ({row.note})</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="facilities">
              <h2 id="facilities" className="text-lg font-semibold text-ink">
                Facilities at {venue.name}
              </h2>
              <p className="mt-1 text-sm text-muted">Shared by every pitch at the venue.</p>
              <div className="mt-3 max-w-sm">
                <FacilityList amenities={venue.amenities} />
              </div>
            </section>
          </div>

          <aside aria-labelledby="location">
            <h2 id="location" className="text-lg font-semibold text-ink">
              Location
            </h2>
            <VenueLocation venue={venue} pitchId={pitch.id} />
            {venue.publishedPitchCount > 1 ? (
              <p className="mt-6 text-sm text-muted">
                {venue.name} has {venue.publishedPitchCount} pitches.{" "}
                <Link
                  href={venuePath(venue.slug)}
                  className="font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  See all pitches
                </Link>
              </p>
            ) : null}
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
