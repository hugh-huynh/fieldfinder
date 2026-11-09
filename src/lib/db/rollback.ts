import "server-only";

import { log as defaultLogger, type Logger } from "@/lib/log";

import type { Sql, Tx } from "./types";

// Compensation for side effects outside the database (PR 2.12, Codex review on #44). Storage writes
// can't join a Postgres transaction, so code that writes an object inside one registers how to undo
// it. If the transaction fails at any point after that (later statements, the idempotency save, or
// the COMMIT itself), the registered undos run, newest first. Nothing runs on success.
//
// Residual risk: if the server process dies mid-transaction, the undos never run. What they clean up
// is then an unreferenced object under an unguessable key.

type Undo = () => Promise<void>;

const undos = new WeakMap<Tx, Undo[]>();

/** Registers `undo` to run if `tx`'s transaction doesn't commit. `tx` must come from `withRollback`. */
export function onRollback(tx: Tx, undo: Undo): void {
  const list = undos.get(tx);
  if (list === undefined) throw new Error("onRollback needs a transaction started by withRollback");
  list.push(undo);
}

/** `sql.begin(body)`, plus running the undos registered with `onRollback` if it doesn't commit. */
export async function withRollback<T>(
  sql: Sql,
  body: (tx: Tx) => Promise<T>,
  logger: Logger = defaultLogger,
): Promise<T> {
  let registered: Undo[] = [];
  try {
    return (await sql.begin(async (tx) => {
      registered = [];
      undos.set(tx, registered);
      return body(tx);
    })) as T;
  } catch (error) {
    for (const undo of registered.reverse()) {
      try {
        await undo();
      } catch (undoError) {
        // Best effort: the original error is what the caller sees.
        logger.error("db.rollback_undo_failed", { error: undoError });
      }
    }
    throw error;
  }
}
