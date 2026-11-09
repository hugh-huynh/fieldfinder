-- 0007_media_buckets: Supabase Storage buckets for venue and pitch images (M2 PR 2.12, D10, ADR-0006).
-- Created here (approved by Hugh, 2026-11-08) so local, staging and production are identical.
-- Forward-only: never edit after merge.
--
--   media-private: every re-encoded upload, keyed by media_assets.storage_key. Not public; reached only
--                  by the server through Storage's S3 protocol.
--   media-public:  a copy of each *published* image under an unguessable key (media_assets.public_key),
--                  served at /storage/v1/object/public/media-public/<key>. Unpublishing deletes it.
--
-- Uploads are re-encoded by sharp to WebP before storage, so WebP is the only type either bucket
-- accepts, capped at the 10 MiB limit media_assets.byte_size already enforces. No storage.objects
-- policies are created: anon and authenticated get nothing, and public reads of media-public go
-- through the public-bucket URL, which doesn't consult them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media-private', 'media-private', false, 10485760, array['image/webp']),
  ('media-public', 'media-public', true, 10485760, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
