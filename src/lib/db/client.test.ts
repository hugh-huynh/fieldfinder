import { describe, expect, it } from "vitest";

import { databaseUrl } from "@/lib/env";

import { connectionOptions } from "./client";

describe("connectionOptions", () => {
  it.each(["public", "admin"] as const)("disables prepared statements and silences notices for %s", (role) => {
    const options = connectionOptions(role);
    expect(options.prepare).toBe(false);
    expect(options.onnotice?.({})).toBeUndefined();
    expect(options.connection).toEqual({ application_name: `fieldfinder-${role}` });
    expect(options.max).toBeLessThanOrEqual(5);
  });
});

describe("databaseUrl", () => {
  const url = "postgresql://ff_public_reader:local@127.0.0.1:54322/postgres";

  it("returns the variable for each role", () => {
    expect(databaseUrl("public", { DATABASE_URL_PUBLIC_READER: url })).toBe(url);
    expect(databaseUrl("admin", { DATABASE_URL_ADMIN_WRITER: url })).toBe(url);
  });

  it("never falls back to the other role's connection", () => {
    expect(() => databaseUrl("admin", { DATABASE_URL_PUBLIC_READER: url })).toThrow("DATABASE_URL_ADMIN_WRITER");
  });

  it("rejects missing or non-postgres values without echoing them", () => {
    expect(() => databaseUrl("public", {})).toThrow(
      "DATABASE_URL_PUBLIC_READER is missing or is not a postgres:// URL",
    );
    expect(() => databaseUrl("public", { DATABASE_URL_PUBLIC_READER: "mysql://u:hunter2@h/db" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("hunter2") as unknown }),
    );
  });
});
