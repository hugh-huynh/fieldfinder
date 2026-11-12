import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { publicDb } from "@/lib/db/public";

import { crawlPublicApi, keyPaths, loadTruth, type Endpoint, type Exchange } from "./crawl";

// DTO key snapshot (PR 2.15, CLAUDE.md rule 3). The exact field paths each public route returns,
// collected across every public response in the seeded data. A new field fails this test until the
// snapshot is updated on purpose (`pnpm test:integration -u`), which makes adding public data a
// reviewed decision, and every path must also be documented in docs/api/openapi.json.

const SCHEMA_FOR: Record<Endpoint, string> = {
  search: "VenueSearchResponse",
  venue: "VenueDetailResponse",
  pitch: "PitchDetailResponse",
};

let exchanges: Exchange[];

beforeAll(async () => {
  exchanges = await crawlPublicApi(await loadTruth());
}, 60_000);

afterAll(async () => {
  await publicDb().end({ timeout: 5 });
});

/** Seeded fixture ids (tests/fixtures/factory.ts). Other integration files add their own records to
 * the shared database, in whatever order the files run; only the seed is the same every time. */
const FIXTURE_ID = /^5eed0000-/;

/** Drops every record (an object with an `id`) that isn't a seeded fixture, at any depth. */
function fixturesOnly(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item: unknown) => !isForeignRecord(item)).map(fixturesOnly);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, fixturesOnly(child)]));
  }
  return value;
}

/** An object with an `id` that isn't a seeded fixture's. */
function isForeignRecord(item: unknown): boolean {
  if (item === null || typeof item !== "object" || !("id" in item)) return false;
  return !FIXTURE_ID.test(String(item.id));
}

function pathsFor(endpoint: Endpoint): string[] {
  const paths = new Set<string>();
  for (const e of exchanges.filter((x) => x.endpoint === endpoint && x.status === 200)) {
    const body = JSON.parse(e.text) as { venue?: { id: string } };
    if (body.venue !== undefined && !FIXTURE_ID.test(body.venue.id)) continue; // another test's venue
    keyPaths(fixturesOnly(body), "", paths);
  }
  return [...paths].sort();
}

type Schema = {
  $ref?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
};

/** Every field path an OpenAPI schema allows, resolving $refs and nullable unions. */
function documentedPaths(schema: Schema, components: Record<string, Schema>, prefix = "", into = new Set<string>()) {
  const resolved = schema.$ref === undefined ? schema : (components[schema.$ref.split("/").pop() ?? ""] ?? {});
  for (const option of [...(resolved.anyOf ?? []), ...(resolved.oneOf ?? [])]) {
    documentedPaths(option, components, prefix, into);
  }
  if (resolved.items !== undefined) documentedPaths(resolved.items, components, `${prefix}[]`, into);
  for (const [key, child] of Object.entries(resolved.properties ?? {})) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    into.add(path);
    documentedPaths(child, components, path, into);
  }
  return into;
}

const openapi = JSON.parse(readFileSync(join(import.meta.dirname, "../../../docs/api/openapi.json"), "utf8")) as {
  components: { schemas: Record<string, Schema> };
};

describe.each(["search", "venue", "pitch"] as const)("public %s response", (endpoint) => {
  it("has exactly the snapshotted field paths", () => {
    const paths = pathsFor(endpoint);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toMatchSnapshot();
  });

  it("returns only fields documented in docs/api/openapi.json", () => {
    const schemas = openapi.components.schemas;
    const documented = documentedPaths({ $ref: `#/components/schemas/${SCHEMA_FOR[endpoint]}` }, schemas);
    expect(pathsFor(endpoint).filter((path) => !documented.has(path))).toEqual([]);
  });
});
