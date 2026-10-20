import { describe, expect, it } from "vitest";

import { databaseUrl } from "@/lib/env";

import { connectionOptions } from "./client";
import { tlsOptions } from "./tls";

describe("connectionOptions", () => {
  it.each(["public", "admin"] as const)("disables prepared statements and silences notices for %s", (role) => {
    const options = connectionOptions(role, "postgres://u:p@127.0.0.1:54322/postgres");
    expect(options.prepare).toBe(false);
    expect(options.onnotice?.({})).toBeUndefined();
    expect(options.connection).toEqual({ application_name: `fieldfinder-${role}` });
    expect(options.max).toBeLessThanOrEqual(5);
  });
});

describe("TLS", () => {
  const remote = "postgresql://ff_public_reader.ref:secret-pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres";

  it("requires TLS for a remote host whose URL doesn't say", () => {
    expect(tlsOptions(remote, "X")).toEqual({ ssl: "require" });
    expect(connectionOptions("public", remote).ssl).toBe("require");
  });

  it.each(["require", "verify-ca", "verify-full"])("leaves sslmode=%s in the URL in charge", (mode) => {
    // An explicit `ssl` option would override the URL, so none is set.
    expect(tlsOptions(`${remote}?sslmode=${mode}`, "X")).toEqual({});
    expect(connectionOptions("admin", `${remote}?sslmode=${mode}`)).not.toHaveProperty("ssl");
  });

  it.each(["disable", "allow", "prefer", "nonsense"])(
    "refuses sslmode=%s for a remote host, without echoing the URL",
    (mode) => {
      expect(() => tlsOptions(`${remote}?sslmode=${mode}`, "DATABASE_URL_PUBLIC_READER")).toThrow(
        `DATABASE_URL_PUBLIC_READER must use TLS for a remote database (sslmode=require or stronger, not "${mode}")`,
      );
      expect(() => tlsOptions(`${remote}?sslmode=${mode}`, "X")).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("secret-pw") as unknown }),
      );
    },
  );

  it.each(["127.0.0.1", "localhost", "[::1]"])("keeps the library default for the local host %s", (host) => {
    expect(tlsOptions(`postgres://u:p@${host}:54322/postgres`, "X")).toEqual({});
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
