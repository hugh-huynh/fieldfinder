# ADR-0006: Media rights and storage

- Status: Accepted (2026-10-11; D10, P4)
- Context: Images are a mix of privately owned and third-party/public-source photos. Spec §4/§5 require rights metadata, private storage before publication and safe transformations.

## Decision

- `media_assets` records `rights_basis` (`owned | licensed | cc0_public_domain | cc_by | cc_by_sa | written_permission`), `author`, `source_url`, `license_name`, `license_url`, `attribution_text`, `evidence_ref`, `commercial_use_ok`.
- Publishing media is **blocked** unless the rights basis and evidence are complete and `commercial_use_ok` is true. Images that are merely publicly visible without a licence, and NC licences, are rejected.
- Attribution text is shown on public pages wherever the licence requires it.
- Uploads go to a private Supabase Storage bucket after magic-byte MIME sniffing, size/dimension limits and a sharp re-encode (strips EXIF/GPS). Publishing copies the re-encoded file to a public bucket under an unguessable key. No antivirus service; decode/re-encode is the mitigation (residual risk documented).
- Served via `next/image` with explicit `remotePatterns`.

## Consequences

- Operators must collect licence evidence before an image can go live.
- Unpublished images never have a public URL.
