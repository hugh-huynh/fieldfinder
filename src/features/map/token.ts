// The Mapbox token rules (PR 3.4). No imports, so next.config.ts can load this at build time.

/**
 * Only a public (`pk.`) token may reach the browser. A secret (`sk.`) token, or anything else, is
 * refused, so a mis-set variable can't hand out a secret.
 */
export function isPublicMapboxToken(token: string | undefined): token is string {
  return token !== undefined && /^pk\.[\w.-]+$/.test(token.trim());
}

/**
 * Fails the build if NEXT_PUBLIC_MAPBOX_TOKEN is set to anything but a public token. Next.js inlines
 * every referenced NEXT_PUBLIC_ value into browser JavaScript, so refusing it at runtime is too late:
 * a secret would already be in the bundle. Unset or blank is fine (the map says it's unavailable).
 * The message never includes the value.
 */
export function assertPublicMapboxToken(token: string | undefined): void {
  if (token === undefined || token.trim() === "") return;
  if (!isPublicMapboxToken(token)) {
    throw new Error(
      "NEXT_PUBLIC_MAPBOX_TOKEN must be a public Mapbox token (starting with `pk.`). It is inlined into browser code, so a secret (`sk.`) token or any other value is refused.",
    );
  }
}
