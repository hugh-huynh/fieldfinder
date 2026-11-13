import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_OPERATIONS, PUBLIC_OPERATIONS } from "@/lib/api/operations";

import { buildOpenApiDocument } from "./document";

// The OpenAPI drift check (PR 2.14, D22). `pnpm openapi:generate` runs this file with OPENAPI_WRITE=1
// to rewrite docs/api/openapi.json; a normal `pnpm test` fails if the committed file is stale.

const ROOT = join(import.meta.dirname, "..", "..", "..");
const OUTPUT = join(ROOT, "docs", "api", "openapi.json");
const API_DIR = join(ROOT, "src", "app", "api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const document = buildOpenApiDocument();
const serialised = `${JSON.stringify(document, null, 2)}\n`;

/**
 * "POST /api/admin/venues/{id}/publish" for every exported handler under src/app/api, with the
 * operation name its wrapper is given: the first string after `export const POST =`, whether that's
 * `apiRoute("…"`, `adminRoute("…"` or `transitionRoute({ name: "…"`.
 */
function implementedOperations(): { operation: string; name: string | undefined }[] {
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
    return METHODS.flatMap((method) => {
      const match = new RegExp(`export const ${method}\\b[^"]*"([^"]*)"`).exec(source);
      return match === null ? [] : [{ operation: `${method} ${path}`, name: match[1] }];
    });
  });
}

type JsonSchema = Record<string, unknown>;

/** Does `value` satisfy the schema's own type, enum, pattern and bounds? (Enough for defaults.) */
function satisfies(schema: JsonSchema, value: unknown): boolean {
  const types = ([] as unknown[]).concat(schema.type ?? []);
  const typeOf = (v: unknown) =>
    v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
  if (types.length > 0) {
    const actual = typeOf(value);
    if (!types.includes(actual) && !(actual === "integer" && types.includes("number"))) return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (typeof value === "string") {
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) return false;
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }
  return true;
}

/** Every schema in the document that has a `default`, and those whose default breaks it. */
function defaultsViolatingSchema(root: unknown): { checked: number; violations: string[] } {
  const violations: string[] = [];
  let checked = 0;
  const walk = (node: unknown, where: string) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => {
        walk(child, `${where}[${String(i)}]`);
      });
      return;
    }
    const schema = node as JsonSchema;
    if ("default" in schema && ("type" in schema || "enum" in schema)) {
      checked += 1;
      if (!satisfies(schema, schema.default)) violations.push(`${where}: ${JSON.stringify(schema.default)}`);
    }
    for (const [key, child] of Object.entries(schema)) walk(child, `${where}/${key}`);
  };
  walk(root, "#");
  return { checked, violations };
}

function documentedOperations(): string[] {
  return Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((method) => method.toLowerCase() in item).map((method) => `${method} ${path}`),
  );
}

describe("OpenAPI document", () => {
  it("documents exactly the routes that exist", () => {
    expect(documentedOperations().sort()).toEqual(
      implementedOperations()
        .map((o) => o.operation)
        .sort(),
    );
  });

  it("names each route as its operationId (both come from src/lib/api/operations.ts)", () => {
    const operationIds = Object.fromEntries(
      Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
        METHODS.map((m) => [`${m} ${path}`, item[m.toLowerCase() as Lowercase<(typeof METHODS)[number]>]?.operationId]),
      ),
    );
    const implemented = implementedOperations();
    expect(implemented.length).toBeGreaterThan(0);
    for (const { operation, name } of implemented) expect(name, operation).toBe(operationIds[operation]);
  });

  it("documents every operation in src/lib/api/operations.ts exactly once", () => {
    const ids = Object.values(document.paths ?? {}).flatMap((item) =>
      METHODS.map((m) => item[m.toLowerCase() as Lowercase<(typeof METHODS)[number]>]?.operationId).filter(Boolean),
    );
    expect([...ids].sort()).toEqual([...PUBLIC_OPERATIONS, ...Object.keys(ADMIN_OPERATIONS)].sort());
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

  it("documents every default in the type its schema declares (Codex, PR #49)", () => {
    const problems = defaultsViolatingSchema(document);
    expect(problems.checked).toBeGreaterThan(0);
    expect(problems.violations).toEqual([]);
  });

  it("the defaults check catches a numeric default on a string parameter", () => {
    const broken = { paths: { "/x": { get: { parameters: [{ schema: { type: "string", default: 10 } }] } } } };
    expect(defaultsViolatingSchema(broken).violations).toHaveLength(1);
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
