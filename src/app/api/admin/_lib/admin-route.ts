import "server-only";

import { apiRoute, type ApiContext } from "@/lib/api/handler";
import { adminScope, type AdminOperation } from "@/lib/api/operations";
import { authenticateAdmin, type AdminPrincipal } from "@/lib/auth/admin";
import { createPostgresCredentialStore } from "@/lib/auth/credential-store";
import { adminDb } from "@/lib/db/admin";
import type { Sql } from "@/lib/db/types";
import { clientIp } from "@/lib/rate-limit/client-ip";
import { createPostgresRateLimiter } from "@/lib/rate-limit/postgres";

// Wrapper for every /api/admin route (ADR-0003, PR 2.9). It authenticates the bearer credential,
// applies the admin rate limits and the scope check, then hands the handler the principal and the
// ff_admin_writer connection. Admin responses are never cached. `_lib` is a private folder: Next.js
// doesn't route it, and it sits inside the only tree ESLint lets import the writer connection.

// Each request goes through these checks in order, and the first one that fails ends the request:
// Request to /api/admin/...
//  │
//  ├─ 1. Token in the URL?            → 400 + "admin.credential_in_url" warning (token never logged)
//  ├─ 2. This client already failed
//  │     10 times this minute?        → 429 + Retry-After
//  ├─ 3. Token missing / malformed /
//  │     unknown / expired / revoked /
//  │     IP not on allowlist?         → 401 (identical every time; counts as a failure)
//  ├─ 4. This credential made 120+
//  │     requests this minute?        → 429 + Retry-After
//  ├─ 5. Lacks the required scope?    → 403
//  └─ ✓ Handler runs with the credential and the writer database connection; response marked no-store

export interface AdminContext<Params> extends ApiContext<Params> {
  admin: AdminPrincipal;
  sql: Sql;
}

export function adminRoute<Params = Record<string, never>>(
  operation: AdminOperation,
  handler: (request: Request, context: AdminContext<Params>) => Promise<Response>,
) {
  const scope = adminScope(operation); // src/lib/api/operations.ts, also what the contract documents
  return apiRoute<Params>(operation, async (request, context) => {
    const sql = adminDb();
    const admin = await authenticateAdmin(request, scope, {
      store: createPostgresCredentialStore(sql),
      limiter: createPostgresRateLimiter(sql),
      clientIp: clientIp(request),
    });
    const original = await handler(request, { ...context, admin, sql });
    const response = new Response(original.body, original);
    response.headers.set("cache-control", "no-store");
    return response;
  });
}
