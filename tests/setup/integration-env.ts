// Connection settings for the integration project (PR 2.7): the local Supabase container only
// (port from supabase/config.toml). The reader and writer passwords are throwaways that
// tests/setup/integration-db.ts sets on the local container; they are valid nowhere else.

export const LOCAL_ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:54322/postgres";
export const LOCAL_READER_URL = "postgres://ff_public_reader:ff_local_reader@127.0.0.1:54322/postgres";
export const LOCAL_WRITER_URL = "postgres://ff_admin_writer:ff_local_writer@127.0.0.1:54322/postgres";
export const TEST_CURSOR_SECRET = "integration-test-cursor-secret-not-for-production";

// Local Supabase Storage (PR 2.12). S3 protocol is enabled in supabase/config.toml. The S3 access
// keys aren't stored in the repo: tests/setup/integration-db.ts reads them from `supabase status`.
export const LOCAL_S3_ENDPOINT = "http://127.0.0.1:54321/storage/v1/s3";
export const LOCAL_MEDIA_PUBLIC_BASE_URL = "http://127.0.0.1:54321/storage/v1/object/public/media-public";
