// Connection settings for the integration project (PR 2.7): the local Supabase container only
// (port from supabase/config.toml). The reader password is a throwaway that
// tests/setup/integration-db.ts sets on the local container; it is valid nowhere else.

export const LOCAL_ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:54322/postgres";
export const LOCAL_READER_URL = "postgres://ff_public_reader:ff_local_reader@127.0.0.1:54322/postgres";
export const TEST_CURSOR_SECRET = "integration-test-cursor-secret-not-for-production";
