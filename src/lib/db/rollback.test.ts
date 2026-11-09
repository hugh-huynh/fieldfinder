import { describe, expect, it } from "vitest";

import { createLogger, type LogLevel } from "@/lib/log";

import { onRollback, withRollback } from "./rollback";
import type { Sql, Tx } from "./types";

// Rollback undos (PR 2.12, Codex review on #44). Against real storage in
// tests/integration/admin-media.test.ts.

/** A fake `sql` whose begin() runs the body, then optionally fails as COMMIT would. */
function fakeSql(options: { failCommit?: boolean } = {}): Sql {
  return {
    begin: async (body: (tx: Tx) => Promise<unknown>) => {
      const result = await body({} as Tx);
      if (options.failCommit === true) throw new Error("commit failed");
      return result;
    },
  } as unknown as Sql;
}

function capture() {
  const lines: { level: LogLevel; line: string }[] = [];
  return { logger: createLogger((level, line) => lines.push({ level, line }), "debug"), lines };
}

describe("withRollback", () => {
  it("runs nothing when the transaction commits", async () => {
    const ran: string[] = [];
    const result = await withRollback(fakeSql(), (tx) => {
      onRollback(tx, () => {
        ran.push("undo");
        return Promise.resolve();
      });
      return Promise.resolve("ok");
    });
    expect(result).toBe("ok");
    expect(ran).toEqual([]);
  });

  it("runs every undo, newest first, when the body fails after registering them", async () => {
    const ran: string[] = [];
    const failure = withRollback(fakeSql(), (tx) => {
      for (const name of ["first", "second"]) {
        onRollback(tx, () => {
          ran.push(name);
          return Promise.resolve();
        });
      }
      return Promise.reject(new Error("later step failed"));
    });
    await expect(failure).rejects.toThrow("later step failed");
    expect(ran).toEqual(["second", "first"]);
  });

  it("runs the undos when the COMMIT itself fails", async () => {
    const ran: string[] = [];
    const failure = withRollback(fakeSql({ failCommit: true }), (tx) => {
      onRollback(tx, () => {
        ran.push("undo");
        return Promise.resolve();
      });
      return Promise.resolve("ok");
    });
    await expect(failure).rejects.toThrow("commit failed");
    expect(ran).toEqual(["undo"]);
  });

  it("keeps the original error and logs an undo that fails, still running the others", async () => {
    const { logger, lines } = capture();
    const ran: string[] = [];
    const failure = withRollback(
      fakeSql(),
      (tx) => {
        onRollback(tx, () => {
          ran.push("kept going");
          return Promise.resolve();
        });
        onRollback(tx, () => Promise.reject(new Error("storage down")));
        return Promise.reject(new Error("original"));
      },
      logger,
    );
    await expect(failure).rejects.toThrow("original");
    expect(ran).toEqual(["kept going"]);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]?.line ?? "{}")).toMatchObject({ level: "error", event: "db.rollback_undo_failed" });
  });

  it("refuses an undo for a transaction it didn't start", () => {
    expect(() => {
      onRollback({} as Tx, () => Promise.resolve());
    }).toThrow("withRollback");
  });
});
