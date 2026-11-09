# ADR-0006: Media rights and storage

- Status: Accepted (2026-10-11; D10, P4)
- Context: Images are a mix of privately owned and third-party/public-source photos. Spec §4/§5 require rights metadata, private storage before publication and safe transformations.

## Decision

- `media_assets` records `rights_basis` (`owned | licensed | cc0_public_domain | cc_by | cc_by_sa | written_permission`), `author`, `source_url`, `license_name`, `license_url`, `attribution_text`, `evidence_ref`, `commercial_use_ok`.
- Publishing media is **blocked** unless the rights basis and evidence are complete and `commercial_use_ok` is true. Images that are merely publicly visible without a licence, and NC licences, are rejected.
- Attribution text is shown on public pages wherever the licence requires it.
- Uploads go to a private Supabase Storage bucket after magic-byte MIME sniffing, size/dimension limits and a sharp re-encode (strips EXIF/GPS). Publishing copies the re-encoded file to a public bucket under an unguessable key. No antivirus service; decode/re-encode is the mitigation (residual risk documented).
- Served via `next/image` with explicit `remotePatterns`. The pages that render images arrive in M3, which adds the storage host to `remotePatterns` and the CSP `img-src`.

## Implementation (PR 2.12, decisions by Hugh 2026-11-08)

- **Buckets in a migration** (0007): `media-private` (not public) and `media-public` (public), both accepting only `image/webp` and capped at 10 MiB. They're identical in every environment.
- **Storage access through Supabase's S3 protocol with S3 access keys.** These reach Storage only, not the database, auth or other APIs. Requests are signed with `aws4fetch`. The app never holds the project's secret or service-role key.
- **Intake** (`src/lib/media/image.ts`):
  - the type is taken from magic bytes: JPEG, PNG, WebP or AVIF only (no SVG, GIF or HEIC);
  - files with bytes after the format's end marker are refused (polyglots);
  - ≤10 MB, ≤10,000 px a side, ≤40 MP decoded (decompression bombs), single frame;
  - re-encoded to WebP, longest edge 2560 px, EXIF orientation applied, all metadata (EXIF, GPS, XMP, ICC) dropped.
- **Publish** copies the private object to `media-public/p/<192-bit random>.webp` and sets `public_key`. **Unpublish** deletes that copy inside the transaction, so a failed delete rolls the unpublish back.
- **Public responses** read only `public_media_v` through the `toMediaDto` allowlist: venue and pitch detail get a gallery, and search results get the first approved image.
- **Archived or unpublished places keep their images, but not their URLs** (Hugh, 2026-11-09).
  - Unpublishing or archiving a venue withdraws its own published images and its pitches'. Unpublishing or archiving a pitch withdraws that pitch's images.
  - Each image returns to draft, its public copy is deleted (so a saved URL stops working) and an audit row is written, in the same transaction as the status change.
  - The record, rights and private original are kept, and re-publishing creates a fresh URL.
- **Planned:** a way to flag such images as "unused" for review or reuse.

## Consequences

- Operators must collect licence evidence before an image can go live.
- Unpublished images never have a public URL.
