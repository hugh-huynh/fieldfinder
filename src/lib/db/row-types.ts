import { z } from "zod";

// Zod helpers for rows returned by postgres.js. It returns bigint and numeric columns as strings
// and timestamptz as Date; these normalise both to plain JSON-safe values.

/** integer / double precision / numeric / bigint → number. */
export const dbNumber = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

/** timestamptz → ISO 8601 string. */
export const dbTimestamp = z.coerce.date().transform((date) => date.toISOString());
