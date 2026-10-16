// Fixture shapes mirroring the database enums and columns (supabase/migrations/0001–0002).
// Synthetic data only: never put real venue data or real people in fixtures.

export type PublicationStatus = "draft" | "published" | "archived";
export type Surface = "grass" | "synthetic" | "hybrid";
export type PitchFormat = "full" | "small_sided" | "training";
export type AccessClass = "public" | "booking_required" | "members_only";
export type AmenityKey = "parking" | "toilets" | "changing_rooms" | "drinking_water" | "cafe" | "public_transport";
export type TriState = "yes" | "no" | "unknown";
export type MediaRightsBasis = "owned" | "licensed" | "cc0_public_domain" | "cc_by" | "cc_by_sa" | "written_permission";
export type SourceKind = "site_visit" | "council_record" | "operator_provided" | "public_web" | "other";
export type ConfidenceLevel = "low" | "medium" | "high";

export interface MediaFixture {
  id: string;
  storageKey: string;
  /** Set only when published (the 0002 publish gate requires it). */
  publicKey: string | null;
  contentType: "image/webp" | "image/avif";
  widthPx: number;
  heightPx: number;
  byteSize: number;
  altText: string;
  displayOrder: number;
  status: PublicationStatus;
  rightsBasis: MediaRightsBasis | null;
  author: string | null;
  sourceUrl: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  attributionText: string | null;
  evidenceRef: string | null;
  commercialUseOk: boolean | null;
}

export interface PitchFixture {
  id: string;
  slug: string;
  name: string;
  surface: Surface | null;
  pitchFormat: PitchFormat | null;
  lengthM: number | null;
  widthM: number | null;
  floodlights: boolean | null;
  /** NULL inherits the venue's access (D11). */
  access: AccessClass | null;
  status: PublicationStatus;
  media: MediaFixture[];
}

export interface VenueFixture {
  id: string;
  slug: string;
  name: string;
  streetAddress: string | null;
  suburb: string;
  state: "VIC";
  postcode: string | null;
  latitude: number;
  longitude: number;
  description: string | null;
  access: AccessClass | null;
  status: PublicationStatus;
  /** Amenities without a row are "not confirmed". */
  amenities: Partial<Record<AmenityKey, TriState>>;
  pitches: PitchFixture[];
  media: MediaFixture[];
}

export interface SourceFixture {
  id: string;
  title: string;
  kind: SourceKind;
  methodology: string | null;
  reference: string | null;
  rightsNote: string | null;
  collectedOn: string | null;
}

export interface VerificationFixture {
  id: string;
  venueId: string | null;
  pitchId: string | null;
  sourceId: string | null;
  verifiedBy: string;
  verifiedOn: string;
  evidence: string | null;
  confidence: ConfidenceLevel;
  internalNotes: string | null;
}

export interface FixtureSet {
  venues: VenueFixture[];
  sources: SourceFixture[];
  verifications: VerificationFixture[];
}
