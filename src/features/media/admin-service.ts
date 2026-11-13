import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { Actor } from "@/features/venues/admin-service";
import { ApiError } from "@/lib/api/errors";
import { recordPublication } from "@/lib/audit/publications";
import { diff, recordRevision } from "@/lib/audit/revisions";
import { onRollback } from "@/lib/db/rollback";
import type { Tx } from "@/lib/db/types";
import type { ProcessedImage } from "@/lib/media/image";
import { PRIVATE_BUCKET, PUBLIC_BUCKET, type MediaStore } from "@/lib/storage/types";

import { toAdminMediaDto, type AdminMediaDto } from "./admin-dto";
import { MEDIA_COLUMNS, type MediaPatch, type MediaUpload } from "./admin-schema";

// Admin media writes (PR 2.12, ADR-0006). One transaction per request, with field_revisions /
// field_publications rows in it. Lock order is always venue → pitch → media, like every other admin
// write (2.11 review), so overlapping requests queue rather than deadlock.
//
// Storage side effects are ordered so a public object never outlives its publication:
//   * upload: the private object is written, then the row; if the transaction doesn't commit, the
//     object is deleted (onRollback, src/lib/db/rollback.ts);
//   * publish: the public copy is written, then the row; if the transaction doesn't commit, at any
//     step up to and including COMMIT, the copy is deleted (onRollback);
//   * unpublish: the row is updated and the public copy deleted inside the transaction, so a failed
//     delete rolls the unpublish back (still published, still consistent) instead of leaving a copy.

export interface MediaDeps {
  store: MediaStore;
  publicUrl: (key: string) => string;
}

/**
 * Every admin image row, with `unused_reason` computed from the same rules as the public views
 * (migration 0003): a venue is public when published with a published pitch, a pitch when it and its
 * venue are published, an image when it's published and its owner is public. Null means in use.
 */
const ADMIN_MEDIA = (tx: Tx) => tx`
  select m.id, m.venue_id, m.pitch_id, m.content_type, m.width_px, m.height_px, m.byte_size, m.alt_text,
         m.display_order, m.status, m.public_key, m.rights_basis, m.author, m.source_url, m.license_name,
         m.license_url, m.attribution_text, m.evidence_ref, m.commercial_use_ok, m.created_at, m.updated_at,
         (extract(epoch from m.updated_at) * 1000000)::bigint::text as version,
         case
           when v.status = 'archived' or pt.status = 'archived' then 'owner_archived'
           when v.status = 'draft' or pt.status = 'draft' then 'owner_draft'
           when not exists (
             select 1 from public.pitches pp where pp.venue_id = v.id and pp.status = 'published'
           ) then 'owner_not_public'
           when m.status = 'archived' then 'image_archived'
           when m.status = 'draft' then 'image_draft'
         end as unused_reason
  from public.media_assets m
  left join public.pitches pt on pt.id = m.pitch_id
  join public.venues v on v.id = coalesce(m.venue_id, pt.venue_id)
`;

const SELECT = (tx: Tx, id: string) => tx`select * from (${ADMIN_MEDIA(tx)}) media where id = ${id}::uuid`;

/**
 * One page of unused images, oldest id first (PR 2.16). `after` is the last id of the previous page.
 * Returns up to `limit` items and the cursor for the next page (null on the last one).
 */
export interface UnusedMediaPage {
  items: AdminMediaDto[];
  /** The last id on this page; pass it back as `cursor`. Null on the last page. */
  nextCursor: string | null;
}

export async function listUnusedMedia(
  tx: Tx,
  page: { limit: number; after: string | null },
  deps: Pick<MediaDeps, "publicUrl">,
): Promise<UnusedMediaPage> {
  const rows = await tx`
    select * from (${ADMIN_MEDIA(tx)}) media
    where unused_reason is not null ${page.after === null ? tx`` : tx`and id > ${page.after}::uuid`}
    order by id
    limit ${page.limit + 1}
  `;
  const items = rows.slice(0, page.limit).map((row) => toAdminMediaDto(row, deps.publicUrl));
  return { items, nextCursor: rows.length > page.limit ? (items.at(-1)?.id ?? null) : null };
}

export async function readAdminMedia(
  tx: Tx,
  id: string,
  deps: Pick<MediaDeps, "publicUrl">,
): Promise<AdminMediaDto | null> {
  const [row] = await SELECT(tx, id);
  return row === undefined ? null : toAdminMediaDto(row, deps.publicUrl);
}

/** Locks the owner for share, venue first then pitch, and returns whether either is archived. */
async function lockOwner(
  tx: Tx,
  owner: { venueId?: string | null; pitchId?: string | null },
): Promise<{ archived: boolean }> {
  let venueId = owner.venueId ?? null;
  if (owner.pitchId != null) {
    const [pitch] = await tx<
      { venue_id: string }[]
    >`select venue_id from public.pitches where id = ${owner.pitchId}::uuid`;
    if (pitch === undefined) throw new ApiError("not_found");
    venueId = pitch.venue_id;
  }
  const [venue] = await tx<
    { status: string }[]
  >`select status from public.venues where id = ${venueId}::uuid for share`;
  if (venue === undefined) throw new ApiError("not_found");
  let pitchArchived = false;
  if (owner.pitchId != null) {
    const [pitch] = await tx<
      { status: string }[]
    >`select status from public.pitches where id = ${owner.pitchId}::uuid for share`;
    if (pitch === undefined) throw new ApiError("not_found");
    pitchArchived = pitch.status === "archived";
  }
  return { archived: venue.status === "archived" || pitchArchived };
}

/** Locks the owner, then the media row, and checks the version. */
async function lockMedia(
  tx: Tx,
  id: string,
  ifMatch: string,
  deps: MediaDeps,
): Promise<{ media: AdminMediaDto; ownerArchived: boolean; publicKey: string | null; storageKey: string }> {
  const [owner] = await tx<{ venue_id: string | null; pitch_id: string | null }[]>`
    select venue_id, pitch_id from public.media_assets where id = ${id}::uuid
  `;
  if (owner === undefined) throw new ApiError("not_found");
  const { archived } = await lockOwner(tx, { venueId: owner.venue_id, pitchId: owner.pitch_id });
  const [keys] = await tx<{ public_key: string | null; storage_key: string }[]>`
    select public_key, storage_key from public.media_assets where id = ${id}::uuid for update
  `;
  if (keys === undefined) throw new ApiError("not_found");
  const media = await readAdminMedia(tx, id, deps);
  if (media === null) throw new ApiError("not_found");
  if (media.version !== ifMatch) {
    throw new ApiError(
      "conflict",
      "This image has changed since you read it. Fetch it again and retry with its new ETag.",
    );
  }
  if (media.status === "archived") throw new ApiError("conflict", "An archived image can't be changed.");
  return { media, ownerArchived: archived, publicKey: keys.public_key, storageKey: keys.storage_key };
}

function columnValues(input: MediaPatch): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(MEDIA_COLUMNS)) {
    const value = input[field as keyof typeof MEDIA_COLUMNS];
    if (value !== undefined) values[column] = value;
  }
  return values;
}

function adminColumns(media: AdminMediaDto): Record<string, unknown> {
  return {
    alt_text: media.alt,
    display_order: media.displayOrder,
    rights_basis: media.rights.basis,
    author: media.rights.author,
    source_url: media.rights.sourceUrl,
    license_name: media.rights.licenseName,
    license_url: media.rights.licenseUrl,
    attribution_text: media.rights.attributionText,
    evidence_ref: media.rights.evidenceRef,
    commercial_use_ok: media.rights.commercialUseOk,
  };
}

/** Why publishing would fail the ADR-0006 gate, or null if it wouldn't. Mirrors the 0002 CHECKs. */
export function publishBlocker(media: AdminMediaDto): string | null {
  const r = media.rights;
  const present = (v: string | null) => v !== null && v.trim() !== "";
  if (r.basis === null) return "Set the image's rights basis before publishing it.";
  if (r.commercialUseOk !== true) return "Publishing needs commercial use to be allowed (commercialUseOk: true).";
  if (!present(r.evidenceRef)) return "Record where the rights evidence is kept (evidenceRef) before publishing.";
  if (r.basis === "cc0_public_domain" && r.sourceUrl === null) return "A public-domain image needs its sourceUrl.";
  if (
    (r.basis === "cc_by" || r.basis === "cc_by_sa") &&
    !(
      present(r.author) &&
      r.sourceUrl !== null &&
      present(r.licenseName) &&
      r.licenseUrl !== null &&
      present(r.attributionText)
    )
  ) {
    return "A CC BY or CC BY-SA image needs author, sourceUrl, licenseName, licenseUrl and attributionText.";
  }
  if (r.licenseName !== null && /(^|[^a-z])nc([^a-z]|$)|non[- ]?commercial/i.test(r.licenseName)) {
    return "Non-commercial licences can't be published.";
  }
  return null;
}

export async function createMedia(
  tx: Tx,
  input: MediaUpload,
  image: ProcessedImage,
  actor: Actor,
  deps: MediaDeps,
): Promise<AdminMediaDto> {
  const { archived } = await lockOwner(tx, { venueId: input.venueId, pitchId: input.pitchId });
  if (archived) throw new ApiError("conflict", "Images can't be added to an archived venue or pitch.");

  const storageKey = `u/${randomUUID()}.webp`;
  await deps.store.put(PRIVATE_BUCKET, storageKey, image.bytes, image.contentType);
  // If the transaction doesn't commit (now or at any later step), the private object goes too.
  onRollback(tx, () => deps.store.delete(PRIVATE_BUCKET, storageKey));
  const values = {
    venue_id: input.venueId ?? null,
    pitch_id: input.pitchId ?? null,
    storage_key: storageKey,
    content_type: image.contentType,
    width_px: image.width,
    height_px: image.height,
    byte_size: image.bytes.byteLength,
    ...columnValues(input),
  };
  const [row] = await tx<{ id: string }[]>`insert into public.media_assets ${tx(values)} returning id`;
  if (row === undefined) throw new Error("insert returned no row");

  // The audit row records what was stored, but never the private storage key.
  const audited = Object.fromEntries(Object.entries(values).filter(([column]) => column !== "storage_key"));
  await recordRevision(tx, {
    entityType: "media_asset",
    entityId: row.id,
    action: "create",
    changes: diff({}, { ...audited, status: "draft" }),
    actor: actor.admin,
    requestId: actor.requestId,
  });
  const media = await readAdminMedia(tx, row.id, deps);
  if (media === null) throw new Error("created media not found");
  return media;
}

export async function updateMedia(
  tx: Tx,
  id: string,
  ifMatch: string,
  patch: MediaPatch,
  actor: Actor,
  deps: MediaDeps,
): Promise<AdminMediaDto> {
  const { media: current } = await lockMedia(tx, id, ifMatch, deps);
  const changes = diff(adminColumns(current), columnValues(patch));
  if (Object.keys(changes).length === 0) return current;

  if (current.status === "published") {
    // A published image must keep satisfying the publish gate (the 0002 CHECK would refuse it anyway).
    const blocker = publishBlocker({ ...current, rights: toPatchedRights(current, patch) });
    if (blocker !== null)
      throw new ApiError("conflict", `This change would break a published image's rights: ${blocker}`);
  }

  const columns = Object.fromEntries(Object.entries(changes).map(([column, { to }]) => [column, to]));
  await tx`update public.media_assets set ${tx(columns)} where id = ${id}::uuid`;
  await recordRevision(tx, {
    entityType: "media_asset",
    entityId: id,
    action: "update",
    changes,
    actor: actor.admin,
    requestId: actor.requestId,
  });
  const updated = await readAdminMedia(tx, id, deps);
  if (updated === null) throw new Error("updated media not found");
  return updated;
}

function toPatchedRights(current: AdminMediaDto, patch: MediaPatch): AdminMediaDto["rights"] {
  const pick = <T>(value: T | undefined, fallback: T) => (value === undefined ? fallback : value);
  return {
    basis: pick(patch.rightsBasis, current.rights.basis),
    author: pick(patch.author, current.rights.author),
    sourceUrl: pick(patch.sourceUrl, current.rights.sourceUrl),
    licenseName: pick(patch.licenseName, current.rights.licenseName),
    licenseUrl: pick(patch.licenseUrl, current.rights.licenseUrl),
    attributionText: pick(patch.attributionText, current.rights.attributionText),
    evidenceRef: pick(patch.evidenceRef, current.rights.evidenceRef),
    commercialUseOk: pick(patch.commercialUseOk, current.rights.commercialUseOk),
  };
}

export async function publishMedia(
  tx: Tx,
  id: string,
  ifMatch: string,
  reason: string | null,
  actor: Actor,
  deps: MediaDeps,
): Promise<AdminMediaDto> {
  const { media, ownerArchived, storageKey } = await lockMedia(tx, id, ifMatch, deps);
  if (media.status === "published") throw new ApiError("conflict", "The image is already published.");
  if (ownerArchived) throw new ApiError("conflict", "Images of an archived venue or pitch can't be published.");
  const blocker = publishBlocker(media);
  if (blocker !== null) throw new ApiError("conflict", blocker);

  const bytes = await deps.store.get(PRIVATE_BUCKET, storageKey);
  if (bytes === null) throw new Error("the private object for this image is missing");

  // 192 random bits: the public URL can't be guessed or enumerated.
  const publicKey = `p/${randomBytes(24).toString("base64url")}.webp`;
  await deps.store.put(PUBLIC_BUCKET, publicKey, bytes, media.contentType);
  // If the transaction doesn't commit (a later statement, the idempotency save or the COMMIT itself),
  // the public copy is deleted, so an image that stays a draft never has a working URL.
  onRollback(tx, () => deps.store.delete(PUBLIC_BUCKET, publicKey));
  await tx`
    update public.media_assets set status = 'published', public_key = ${publicKey} where id = ${id}::uuid
  `;
  await recordPublication(tx, {
    entityType: "media_asset",
    entityId: id,
    from: media.status,
    to: "published",
    reason,
    actor: actor.admin,
    requestId: actor.requestId,
  });
  const published = await readAdminMedia(tx, id, deps);
  if (published === null) throw new Error("published media not found");
  return published;
}

export async function unpublishMedia(
  tx: Tx,
  id: string,
  ifMatch: string,
  reason: string | null,
  actor: Actor,
  deps: MediaDeps,
): Promise<AdminMediaDto> {
  // Allowed even when the owner is archived: that's when a public copy most needs to go.
  const { media, publicKey } = await lockMedia(tx, id, ifMatch, deps);
  if (media.status !== "published") throw new ApiError("conflict", "The image isn't published.");
  await tx`update public.media_assets set status = 'draft', public_key = null where id = ${id}::uuid`;
  await recordPublication(tx, {
    entityType: "media_asset",
    entityId: id,
    from: "published",
    to: "draft",
    reason,
    actor: actor.admin,
    requestId: actor.requestId,
  });
  // Inside the transaction: if the delete fails, the unpublish rolls back rather than leaving a copy.
  if (publicKey !== null) await deps.store.delete(PUBLIC_BUCKET, publicKey);
  const draft = await readAdminMedia(tx, id, deps);
  if (draft === null) throw new Error("unpublished media not found");
  return draft;
}

/**
 * Withdraws every published image of a venue (its own and its pitches') or of one pitch, when that
 * venue or pitch is unpublished or archived (Hugh, 2026-11-09: keep the images, kill the public URL;
 * spec §4: no unpublished content via image URLs). Each image returns to draft, its public copy is
 * deleted and a field_publications row is written; the record, rights and private original are kept,
 * so it can be published again later (with a fresh URL).
 *
 * Call inside the transition's transaction, after the venue (and pitch) rows are locked: the lock
 * order stays venue → pitch → media. Storage is only touched, and `deps` only built, when there's
 * something to withdraw, so places without images never need storage configured.
 */
export async function withdrawPublishedMedia(
  tx: Tx,
  owner: { venueId: string } | { pitchId: string },
  reason: string | null,
  actor: Actor,
  deps: () => MediaDeps,
): Promise<number> {
  const rows =
    "venueId" in owner
      ? await tx<{ id: string; public_key: string }[]>`
          select id, public_key from public.media_assets
          where status = 'published'
            and (venue_id = ${owner.venueId}::uuid
                 or pitch_id in (select id from public.pitches where venue_id = ${owner.venueId}::uuid))
          order by id for update
        `
      : await tx<{ id: string; public_key: string }[]>`
          select id, public_key from public.media_assets
          where status = 'published' and pitch_id = ${owner.pitchId}::uuid
          order by id for update
        `;
  if (rows.length === 0) return 0;

  const { store } = deps();
  for (const row of rows) {
    await tx`update public.media_assets set status = 'draft', public_key = null where id = ${row.id}::uuid`;
    await recordPublication(tx, {
      entityType: "media_asset",
      entityId: row.id,
      from: "published",
      to: "draft",
      reason,
      actor: actor.admin,
      requestId: actor.requestId,
    });
    // Inside the transaction: if a delete fails, the whole transition rolls back.
    await store.delete(PUBLIC_BUCKET, row.public_key);
  }
  return rows.length;
}
