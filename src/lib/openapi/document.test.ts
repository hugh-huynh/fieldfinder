import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "./document";

// The OpenAPI drift check (PR 2.14, D22). `pnpm openapi:generate` runs this file with OPENAPI_WRITE=1
// to rewrite docs/api/openapi.json; a normal `pnpm test` fails if the committed file is stale.

const ROOT = join(import.meta.dirname, "..", "..", "..");
const OUTPUT = join(ROOT, "docs", "api", "openapi.json");
const API_DIR = join(ROOT, "src", "app", "api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const document = buildOpenApiDocument();
const serialised = `${JSON.stringify(document, null, 2)}\n`;

/** "POST /api/admin/venues/{id}/publish" for every exported handler under src/app/api. */
function implementedOperations(): string[] {
  const routes = readdirSync(API_DIR, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(`${sep}route.ts`) || file === "route.ts",
  );
  return routes.flatMap((file) => {
    const source = readFileSync(join(API_DIR, file), "utf8");
    const path = `/${relative(ROOT, join(API_DIR, file))}`
      .replace(/^\/src\/app/, "")
      .replace(/\/route\.ts$/, "")
      .split(sep)
      .join("/")
      .replace(/\[([A-Za-z]+)\]/g, "{$1}");
    return METHODS.filter((method) => new RegExp(`export const ${method}\\b`).test(source)).map(
      (method) => `${method} ${path}`,
    );
  });
}

function documentedOperations(): string[] {
  return Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((method) => method.toLowerCase() in item).map((method) => `${method} ${path}`),
  );
}

describe("OpenAPI document", () => {
  it("documents exactly the routes that exist", () => {
    expect(documentedOperations().sort()).toEqual(implementedOperations().sort());
  });

  it("matches docs/api/openapi.json (run `pnpm openapi:generate` after changing the API)", () => {
    if (process.env.OPENAPI_WRITE === "1") writeFileSync(OUTPUT, serialised);
    expect(readFileSync(OUTPUT, "utf8")).toBe(serialised);
  });

  it("resolves every $ref", () => {
    const refs = [...serialised.matchAll(/"\$ref": "#\/components\/(\w+)\/(\w+)"/g)];
    expect(refs.length).toBeGreaterThan(0);
    const components = document.components as Record<string, Record<string, unknown> | undefined>;
    for (const [ref, kind = "", name = ""] of refs) expect(components[kind]?.[name], ref).toBeDefined();
  });

  it("gives every operation a unique operationId", () => {
    const ids = Object.values(document.paths ?? {}).flatMap((item) =>
      METHODS.map((m) => item[m.toLowerCase() as Lowercase<(typeof METHODS)[number]>]?.operationId).filter(Boolean),
    );
    expect(ids).toHaveLength(documentedOperations().length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("requires the admin token on every admin route and on no public one", () => {
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of METHODS) {
        const operation = item[method.toLowerCase() as Lowercase<(typeof METHODS)[number]>];
        if (operation === undefined) continue;
        expect(operation.security, `${method} ${path}`).toEqual(
          path.startsWith("/api/admin/") ? [{ adminToken: [] }] : undefined,
        );
      }
    }
  });

  it("never names a private field in a public response", () => {
    const schemas = document.components?.schemas ?? {};
    const publicSchemas = ["VenueSearchResponse", "VenueDetailResponse", "PitchDetailResponse", "SuggestResponse"];
    expect(Object.keys(schemas)).toEqual(expect.arrayContaining(publicSchemas));
    const text = JSON.stringify(
      Object.entries(schemas).filter(([name]) => !name.startsWith("Admin") && name !== "VenueTransitionResponse"),
    );
    for (const field of ["internalNotes", "evidence", "evidenceRef", "verifiedBy", "status", "version", "storageKey"]) {
      expect(text, field).not.toContain(`"${field}"`);
    }
  });
});
