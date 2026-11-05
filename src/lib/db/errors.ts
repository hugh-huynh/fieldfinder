// Recognising specific Postgres errors (PR 2.10) without ever passing their text on: messages and
// DETAIL can contain row values (2.2 note), so callers map them to their own public messages.

/** True when `error` is a unique violation (23505) of `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint_name?: unknown };
  return e.code === "23505" && e.constraint_name === constraint;
}
