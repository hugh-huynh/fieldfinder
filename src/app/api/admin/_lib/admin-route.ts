import "server-only";

import { apiRoute, type ApiContext } from "@/lib/api/handler";
import { authenticateAdmin, type AdminPrincipal } from "@/lib/auth/admin";
import { createPostgresCredentialStore } from "@/lib/auth/credential-store";
import type { AdminScope } from "@/lib/auth/scopes";
import { adminDb } from "@/lib/db/admin";
import type { Sql } from "@/lib/db/types";
import { clientIp } from "@/lib/rate-limit/client-ip";
import { createPostgresRateLimiter } from "@/lib/rate-limit/postgres";

// Wrapper for every /api/admin route (ADR-0003, PR 2.9). It authenticates the bearer credential,
// applies the admin rate limits and the scope check, then hands the handler the principal and the
// ff_admin_writer connection. Admin responses are never cached. `_lib` is a private folder: Next.js
// doesn't route it, and it sits inside the only tree ESLint lets import the writer connection.

export interface AdminContext<Params> extends ApiContext<Params> {
  admin: AdminPrincipal;
  sql: Sql;
}

export function adminRoute<Params = Record<string, never>>(
  route: string,
  scope: AdminScope,
  handler: (request: Request, context: AdminContext<Params>) => Promise<Response>,
) {
  return apiRoute<Params>(route, async (request, context) => {
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
