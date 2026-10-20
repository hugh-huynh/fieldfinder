import "server-only";

import { z } from "zod";

import type { Sql } from "@/lib/db/types";

// Reads admin_api_credentials as ff_admin_writer (SELECT, plus UPDATE of last_used_at only:
// migration 0003). Minting, rotating and revoking happen in scripts/admin-credential.ts.

export interface CredentialRecord {
  id: string;
  label: string;
  scopes: string[];
  tokenHash: Buffer;
  expiresAt: Date;
  revokedAt: Date | null;
  /** False when the credential has an IP allowlist that doesn't contain the client's IP. */
  ipAllowed: boolean;
}

export interface CredentialStore {
  findByTokenHash(tokenHash: Buffer, clientIp: string | null): Promise<CredentialRecord | null>;
  /** Records use. Writes at most once a minute per credential, not on every request. */
  touch(id: string): Promise<void>;
}

const credentialRow = z.object({
  id: z.uuid(),
  label: z.string(),
  scopes: z.array(z.string()),
  token_hash: z.instanceof(Buffer),
  expires_at: z.coerce.date(),
  revoked_at: z.coerce.date().nullable(),
  ip_allowed: z.boolean(),
});

export function createPostgresCredentialStore(sql: Sql): CredentialStore {
  return {
    async findByTokenHash(tokenHash, clientIp) {
      // An unknown client IP never matches an allowlist.
      const [row] = await sql`
        select id, label, scopes, token_hash, expires_at, revoked_at,
               (ip_allowlist is null or coalesce(${clientIp}::inet <<= any(ip_allowlist), false)) as ip_allowed
        from public.admin_api_credentials
        where token_hash = ${tokenHash}::bytea
      `;
      if (row === undefined) return null;
      const r = credentialRow.parse(row);
      return {
        id: r.id,
        label: r.label,
        scopes: r.scopes,
        tokenHash: r.token_hash,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        ipAllowed: r.ip_allowed,
      };
    },

    async touch(id) {
      await sql`
        update public.admin_api_credentials set last_used_at = now()
        where id = ${id}::uuid and (last_used_at is null or last_used_at < now() - interval '1 minute')
      `;
    },
  };
}
