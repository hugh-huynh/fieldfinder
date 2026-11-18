import { describe, expect, it } from "vitest";

import { sitemapEntries } from "@/features/seo/sitemap";
import { pitchPath, venuePath } from "@/features/venues/route-target";
import { publicDb } from "@/lib/db/public";

import { fixtures, PRIVATE_SENTINEL } from "../fixtures/venues";

// The sitemap's entries against the seeded local database, read as ff_public_reader exactly as
// /sitemap.xml is (PR 4.2, D9). Run `pnpm db:reset` first. The expected list is worked out from the
// fixtures independently of the views: a venue is public only while it's published and has a
// published pitch; a pitch only while it and its venue are published (spec §4).

const ORIGIN = "https://ff.test";
const absolute = (path: string) => `${ORIGIN}${path}`;

const publicVenues = fixtures.venues.filter(
  (venue) => venue.status === "published" && venue.pitches.some((pitch) => pitch.status === "published"),
);
const expectedVenueUrls = publicVenues.map((venue) => absolute(venuePath(venue.slug)));
const expectedPitchUrls = publicVenues.flatMap((venue) =>
  venue.pitches
    .filter((pitch) => pitch.status === "published")
    .map((pitch) => absolute(pitchPath(venue.slug, pitch.slug))),
);

describe("sitemap entries", () => {
  it("lists exactly the published venues and pitches, plus the fixed pages", async () => {
    const entries = await sitemapEntries(publicDb(), absolute);
    const urls = entries.map((entry) => entry.url);

    expect(urls.slice(0, 3)).toEqual([absolute("/"), absolute("/privacy"), absolute("/terms")]);
    expect(new Set(urls.filter((url) => /\/venues\/[^/]+$/.test(url)))).toEqual(new Set(expectedVenueUrls));
    expect(new Set(urls.filter((url) => url.includes("/pitches/")))).toEqual(new Set(expectedPitchUrls));
    expect(urls).toHaveLength(3 + expectedVenueUrls.length + expectedPitchUrls.length);
    // Every data page says when it last changed.
    for (const entry of entries.slice(3)) expect(entry.lastModified).toEqual(expect.any(String));
  });

  it("leaves out drafts, archived records, pitch-less venues and pitches under unpublished venues", async () => {
    const urls = (await sitemapEntries(publicDb(), absolute)).map((entry) => entry.url);
    const text = JSON.stringify(urls);
    expect(text).not.toContain(PRIVATE_SENTINEL);

    for (const slug of ["hidden-draft-park", "old-mill-oval", "lilly-pilly-fields"]) {
      expect(urls.some((url) => url.includes(`/venues/${slug}`))).toBe(false);
    }
    expect(urls).not.toContain(absolute(pitchPath("banksias-corner-reserve", "draft-pitch")));
    expect(urls).not.toContain(absolute(pitchPath("saltbush-sports-park", "old-pitch")));
    // The published neighbours of those drafts are still there, so the test isn't passing on an empty list.
    expect(urls).toContain(absolute(pitchPath("banksias-corner-reserve", "north-pitch")));
    expect(urls).toContain(absolute(pitchPath("saltbush-sports-park", "east-pitch")));
  });
});
