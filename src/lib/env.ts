import "server-only";

import { z } from "zod";

// Server-only configuration. Values are read lazily so `next build` works without database
// credentials, and errors name the variable but never echo its value (it contains a password).

/** Variable holding each role's connection string. */
export const DATABASE_URL_VARS = {
  public: "DATABASE_URL_PUBLIC_READER",
  admin: "DATABASE_URL_ADMIN_WRITER",
} as const;

/** Database role a connection runs as (ADR-0002). */
export type DbRole = keyof typeof DATABASE_URL_VARS;

const postgresUrl = z
  .string()
  .refine((value) => /^postgres(ql)?:\/\//.test(value) && URL.canParse(value), "must be a postgres:// URL");

/** Connection string for `role`, validated. Throws without revealing the value. */
export function databaseUrl(role: DbRole, source: Record<string, string | undefined> = process.env): string {
  const name = DATABASE_URL_VARS[role];
  const parsed = postgresUrl.safeParse(source[name]);
  if (!parsed.success) {
    throw new Error(`${name} is missing or is not a postgres:// URL`);
  }
  return parsed.data;
}

/** Name of the variable holding the key that signs search cursors (PR 2.7). */
export const SEARCH_CURSOR_SECRET_VAR = "SEARCH_CURSOR_SECRET";

/**
 * Key for signing search cursors: at least 32 bytes, server-only. Throws without revealing the value.
 * Rotating it only invalidates cursors already handed out (clients restart from page one).
 */
export function searchCursorSecret(source: Record<string, string | undefined> = process.env): string {
  const value = source[SEARCH_CURSOR_SECRET_VAR];
  if (value === undefined || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(`${SEARCH_CURSOR_SECRET_VAR} is missing or shorter than 32 bytes`);
  }
  return value;
}

/** Supabase Storage through its S3 protocol (PR 2.12): server-only, Storage-only credentials. */
export interface StorageConfig {
  /** e.g. https://<ref>.storage.supabase.co/storage/v1/s3, or http://127.0.0.1:54321/storage/v1/s3 locally. */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const STORAGE_VARS = {
  endpoint: "SUPABASE_S3_ENDPOINT",
  region: "SUPABASE_S3_REGION",
  accessKeyId: "SUPABASE_S3_ACCESS_KEY_ID",
  secretAccessKey: "SUPABASE_S3_SECRET_ACCESS_KEY",
} as const;

/** Storage credentials, validated. Errors name the variable, never its value. */
export function storageConfig(source: Record<string, string | undefined> = process.env): StorageConfig {
  const read = (key: keyof typeof STORAGE_VARS): string => {
    const value = source[STORAGE_VARS[key]];
    if (value === undefined || value.trim() === "") throw new Error(`${STORAGE_VARS[key]} is missing`);
    return value.trim();
  };
  const endpoint = read("endpoint");
  if (!/^https?:\/\//.test(endpoint) || !URL.canParse(endpoint)) {
    throw new Error(`${STORAGE_VARS.endpoint} is not an http(s) URL`);
  }
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    region: read("region"),
    accessKeyId: read("accessKeyId"),
    secretAccessKey: read("secretAccessKey"),
  };
}

export const MEDIA_PUBLIC_BASE_URL_VAR = "MEDIA_PUBLIC_BASE_URL";

/**
 * Base URL of the public media bucket (not secret), e.g.
 * https://<ref>.supabase.co/storage/v1/object/public/media-public. Public image URLs are this plus
 * the object's unguessable key.
 */
export function mediaPublicBaseUrl(source: Record<string, string | undefined> = process.env): string {
  const value = source[MEDIA_PUBLIC_BASE_URL_VAR]?.trim();
  if (value === undefined || !/^https?:\/\//.test(value) || !URL.canParse(value)) {
    throw new Error(`${MEDIA_PUBLIC_BASE_URL_VAR} is missing or not an http(s) URL`);
  }
  return value.replace(/\/+$/, "");
}

export const MAPBOX_GEOCODING_TOKEN_VAR = "MAPBOX_GEOCODING_TOKEN";

/**
 * Server-only Mapbox token for the location suggester (PR 2.13, D6). It only needs geocoding access
 * and is never sent to browsers (the client map token, M3, is a separate URL-restricted one).
 * Throws without revealing the value.
 */
export function mapboxGeocodingToken(source: Record<string, string | undefined> = process.env): string {
  const value = source[MAPBOX_GEOCODING_TOKEN_VAR]?.trim();
  if (value === undefined || !/^[ps]k\.[A-Za-z0-9._-]{20,}$/.test(value)) {
    throw new Error(`${MAPBOX_GEOCODING_TOKEN_VAR} is missing or doesn't look like a Mapbox token`);
  }
  return value;
}
