// Deterministic randomness for property-style tests: a failure always reproduces with the same seed.

/** mulberry32: small, fast, seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const SENTINEL = "ff-private-sentinel";

// Column names that exist on private tables or could plausibly be added to a view by mistake.
const PRIVATE_COLUMNS = [
  "status",
  "storage_key",
  "evidence_ref",
  "rights_basis",
  "commercial_use_ok",
  "internal_notes",
  "verified_by",
  "token_hash",
  "created_at",
  "detail",
  "password",
  "constructor",
  "toString",
];

/**
 * Copy of `row` with 1–8 extra keys whose values all contain the sentinel: private column names,
 * random identifiers, nested objects and arrays.
 */
export function withRandomExtras(row: Record<string, unknown>, rand: () => number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  const count = 1 + Math.floor(rand() * 8);
  for (let i = 0; i < count; i++) {
    const key =
      rand() < 0.6
        ? (PRIVATE_COLUMNS[Math.floor(rand() * PRIVATE_COLUMNS.length)] ?? "status")
        : `x_${Math.floor(rand() * 1e9).toString(36)}`;
    const shape = Math.floor(rand() * 3);
    out[key] = shape === 0 ? `${SENTINEL}-${String(i)}` : shape === 1 ? { nested: SENTINEL } : [SENTINEL, i];
  }
  return out;
}

/** Sorted dotted key paths of a plain object, e.g. ["id", "location.latitude"]. */
export function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}
