import type { VenueDetailDto } from "../dto";
import { directionsUrl } from "../directions";

// A venue's address and "Get directions" (PRs 3.10, 3.11), shared by the venue and pitch pages.
// Directions go to the venue's public coordinates (pitches have none of their own).

export function venueAddress(venue: Pick<VenueDetailDto, "streetAddress" | "suburb" | "state" | "postcode">): string {
  const locality = `${venue.suburb} ${venue.state}${venue.postcode === null ? "" : ` ${venue.postcode}`}`;
  return venue.streetAddress === null ? locality : `${venue.streetAddress}, ${locality}`;
}

export function VenueLocation({ venue }: { venue: VenueDetailDto }) {
  return (
    <>
      <address className="mt-2 text-ink not-italic">{venueAddress(venue)}</address>
      <a
        href={directionsUrl(venue.location.latitude, venue.location.longitude)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-primary px-6 font-semibold text-surface hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Get directions
        <span className="sr-only">(opens Google Maps in a new tab)</span>
      </a>
    </>
  );
}
