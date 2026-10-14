import type { FixtureSet, MediaFixture } from "./types.ts";

type SqlValue = string | number | boolean | null;

/** Renders one SQL literal. Strings are single-quoted with quotes doubled (standard_conforming_strings). */
export function sqlLiteral(value: SqlValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`non-finite number in fixture: ${String(value)}`);
    return String(value);
  }
  if (value.includes("\0")) throw new RangeError("NUL character in fixture string");
  return `'${value.replaceAll("'", "''")}'`;
}

function insert(table: string, columns: readonly string[], rows: readonly (readonly SqlValue[])[]): string {
  if (rows.length === 0) return "";
  const values = rows.map((row) => {
    if (row.length !== columns.length)
      throw new Error(`${table}: expected ${String(columns.length)} values, got ${String(row.length)}`);
    return `  (${row.map(sqlLiteral).join(", ")})`;
  });
  return `insert into public.${table} (${columns.join(", ")}) values\n${values.join(",\n")};\n`;
}

const MEDIA_COLUMNS = [
  "id",
  "venue_id",
  "pitch_id",
  "storage_key",
  "public_key",
  "content_type",
  "width_px",
  "height_px",
  "byte_size",
  "alt_text",
  "display_order",
  "status",
  "rights_basis",
  "author",
  "source_url",
  "license_name",
  "license_url",
  "attribution_text",
  "evidence_ref",
  "commercial_use_ok",
] as const;

function mediaRow(m: MediaFixture, venueId: string | null, pitchId: string | null): SqlValue[] {
  return [
    m.id,
    venueId,
    pitchId,
    m.storageKey,
    m.publicKey,
    m.contentType,
    m.widthPx,
    m.heightPx,
    m.byteSize,
    m.altText,
    m.displayOrder,
    m.status,
    m.rightsBasis,
    m.author,
    m.sourceUrl,
    m.licenseName,
    m.licenseUrl,
    m.attributionText,
    m.evidenceRef,
    m.commercialUseOk,
  ];
}

/** Deterministic seed SQL for `supabase db reset`. Same fixtures in, byte-identical SQL out. */
export function renderSeedSql(set: FixtureSet): string {
  const { venues, sources, verifications } = set;
  const pitches = venues.flatMap((v) => v.pitches.map((p) => ({ venueId: v.id, pitch: p })));

  const parts = [
    "-- GENERATED FILE: do not edit by hand.\n" +
      "-- Source: tests/fixtures/venues.ts · Regenerate: pnpm seed:generate\n" +
      "-- Synthetic data for local development and tests only. Never load this into staging or production.\n",
    insert(
      "field_sources",
      ["id", "title", "kind", "methodology", "reference", "rights_note", "collected_on"],
      sources.map((s) => [s.id, s.title, s.kind, s.methodology, s.reference, s.rightsNote, s.collectedOn]),
    ),
    insert(
      "venues",
      [
        "id",
        "slug",
        "name",
        "street_address",
        "suburb",
        "state",
        "postcode",
        "latitude",
        "longitude",
        "description",
        "access",
        "status",
      ],
      venues.map((v) => [
        v.id,
        v.slug,
        v.name,
        v.streetAddress,
        v.suburb,
        v.state,
        v.postcode,
        v.latitude,
        v.longitude,
        v.description,
        v.access,
        v.status,
      ]),
    ),
    insert(
      "venue_amenities",
      ["venue_id", "amenity", "state"],
      venues.flatMap((v) =>
        Object.entries(v.amenities)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([amenity, state]) => [v.id, amenity, state]),
      ),
    ),
    insert(
      "pitches",
      [
        "id",
        "venue_id",
        "slug",
        "name",
        "surface",
        "pitch_format",
        "length_m",
        "width_m",
        "floodlights",
        "access",
        "status",
      ],
      pitches.map(({ venueId, pitch: p }) => [
        p.id,
        venueId,
        p.slug,
        p.name,
        p.surface,
        p.pitchFormat,
        p.lengthM,
        p.widthM,
        p.floodlights,
        p.access,
        p.status,
      ]),
    ),
    insert("media_assets", MEDIA_COLUMNS, [
      ...venues.flatMap((v) => v.media.map((m) => mediaRow(m, v.id, null))),
      ...pitches.flatMap(({ pitch: p }) => p.media.map((m) => mediaRow(m, null, p.id))),
    ]),
    insert(
      "field_verifications",
      [
        "id",
        "venue_id",
        "pitch_id",
        "source_id",
        "verified_by",
        "verified_on",
        "evidence",
        "confidence",
        "internal_notes",
      ],
      verifications.map((f) => [
        f.id,
        f.venueId,
        f.pitchId,
        f.sourceId,
        f.verifiedBy,
        f.verifiedOn,
        f.evidence,
        f.confidence,
        f.internalNotes,
      ]),
    ),
  ];

  return parts.filter((p) => p !== "").join("\n");
}
