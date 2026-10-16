// Writes supabase/seed.sql from tests/fixtures/venues.ts. Run with `pnpm seed:generate`.
// A unit test fails if the committed seed.sql drifts from the fixtures.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderSeedSql } from "../tests/fixtures/seed-sql.ts";
import { fixtures } from "../tests/fixtures/venues.ts";

const target = fileURLToPath(new URL("../supabase/seed.sql", import.meta.url));
writeFileSync(target, renderSeedSql(fixtures));
console.warn(`wrote ${target}`);
