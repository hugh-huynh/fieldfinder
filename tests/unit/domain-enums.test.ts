import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCESS_CLASSES, AMENITY_KEYS, PITCH_FORMATS, SURFACES } from "@/lib/domain/enums";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/0001_core.sql", import.meta.url)),
  "utf8",
);

function dbEnum(name: string): string[] {
  const match = new RegExp(`create type public\\.${name} as enum \\(([^)]*)\\)`).exec(migration);
  if (!match?.[1]) throw new Error(`enum ${name} not found in 0001_core.sql`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] ?? "");
}

describe("public enums match the database", () => {
  it.each([
    ["surface", SURFACES],
    ["pitch_format", PITCH_FORMATS],
    ["access_class", ACCESS_CLASSES],
    ["amenity_key", AMENITY_KEYS],
  ] as const)("%s", (name, values) => {
    expect([...values]).toEqual(dbEnum(name));
  });
});
