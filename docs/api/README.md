# FieldFinder API

The contract is [`openapi.json`](openapi.json) (OpenAPI 3.1). It's generated from the same Zod schemas the routes validate with, so it can't describe a parameter the code doesn't accept. Open it in any OpenAPI viewer (for example, paste it into editor.swagger.io).

This page covers what the schema can't: conventions, how the pieces fit together, and curl samples. Every value below is fake.

- [Conventions](#conventions)
- [Public API](#public-api)
- [Admin API](#admin-api)
- [Changing the API](#changing-the-api)
- Operator runbook: [admin-operations.md](admin-operations.md)

## Conventions

**Base URL.** Examples use `$FF`, e.g. `export FF=https://fieldfinder.example`. Preview deployments sit behind Vercel's deployment protection: use `vercel curl <path> --deployment <preview URL>` in place of `curl "$FF<path>"`.

**Errors** always have the same shape, whatever the route:

```json
{ "code": "not_found", "message": "Not found.", "requestId": "0b7e7c38-4d1f-4a8e-9b52-2f1d3c4e5a6b" }
```

| Status | `code`                 | When                                                                                                   |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 400    | `invalid_request`      | A parameter, header or body field failed validation. The message names the fields, never their values. |
| 401    | `unauthenticated`      | Admin token missing, malformed, expired or revoked.                                                    |
| 403    | `forbidden`            | Token lacks the route's scope, or the client IP isn't on its allowlist.                                |
| 404    | `not_found`            | Doesn't exist. Public routes say the same for anything unpublished, without saying why.                |
| 409    | `conflict`             | Stale `If-Match`, or the change isn't allowed in the record's current state (message says which).      |
| 422    | `idempotency_mismatch` | The `Idempotency-Key` was already used for a different request.                                        |
| 429    | `rate_limited`         | Too many requests. Admin responses include `Retry-After` (seconds).                                    |
| 500    | `internal`             | Unexpected error. Quote the `requestId`.                                                               |
| 503    | `unavailable`          | The database, storage or Mapbox isn't reachable. Retry later.                                          |

Every response carries `X-Request-Id`, the same value as `requestId`. Client-supplied request ids are ignored.

**Unknown means unknown.** A `null` attribute (surface, floodlights, dimensions…) is "not confirmed". In public responses, an amenity that isn't confirmed is simply absent from `amenities`; it never appears as `"no"`.

**Strict input.** Unknown query parameters or body fields, and repeated query parameters, are a 400. Nothing is silently ignored.

**Rate limits.** Public routes are limited per IP at the edge (Vercel Firewall, [ADR-0004](../architecture/decisions/ADR-0004-edge-and-rate-limiting.md)): search 60/min, details 120/min, location suggest 30/min. Admin routes add a per-token limit (120/min) and a per-IP limit on failed logins (10/min) in the app. Thresholds will be tuned against real traffic.

## Public API

No authentication. Published data only: drafts, archived records, internal notes, verifications and image rights evidence never appear.

### Search: `GET /api/venues`

```sh
curl -s "$FF/api/venues?lat=-37.814&lng=144.963&radiusKm=15&surface=grass&amenities=parking,toilets"
```

```json
{
  "items": [
    {
      "id": "5eed0000-0000-4000-8000-000000000001",
      "slug": "wattlebird-reserve",
      "name": "Wattlebird Reserve",
      "suburb": "Brunswick",
      "state": "VIC",
      "location": { "latitude": -37.767, "longitude": 144.96 },
      "access": "public",
      "distanceMeters": 5236,
      "publishedPitchCount": 2,
      "matchingPitchCount": 1,
      "href": "/venues/wattlebird-reserve",
      "amenities": { "parking": "yes", "toilets": "yes", "cafe": "no" },
      "image": null
    }
  ],
  "totalCount": 1,
  "nextCursor": null
}
```

- `lat` and `lng` are required. `radiusKm` is 1–50 (default 10), `limit` 1–30 (default 20).
- Pitch filters (`surface`, `pitchSize`, `lighting`, `access`) must all be met by **the same pitch**. `matchingPitchCount` says how many pitches do. `amenities` are venue-level and all must be `"yes"`.
- Results are nearest first. `distanceMeters` is measured from the search centre after rounding.
- **Canonical URLs.** Coordinates are rounded to 3 decimal places, and any other spelling of the same search (different parameter order, defaults written out, extra digits) gets a **308** to the canonical URL. Build URLs in canonical form to save the round trip: parameters in the order `lat, lng, radiusKm, surface, pitchSize, lighting, access, amenities, limit, cursor`; defaults left out; amenities in the order `parking, toilets, changing_rooms, drinking_water, cafe, public_transport`.
- **Paging.** Pass `nextCursor` back as `cursor` with the same filters. A cursor from a different search is a 400.
- `href` is the page to open: the pitch page when the venue has exactly one published pitch, else the venue page.
- Cached at the edge for 60 s.

### Venue: `GET /api/venues/{venueSlug}`

```sh
curl -s "$FF/api/venues/wattlebird-reserve"
```

Returns `{ venue, pitches, media }`: the venue, its published pitches (by name) and its published images (in display order). 404 if the venue isn't public.

### Pitch: `GET /api/venues/{venueSlug}/pitches/{pitchSlug}`

```sh
curl -s "$FF/api/venues/wattlebird-reserve/pitches/north-pitch"
```

Returns `{ pitch, venue, media, venueMedia }`. `pitch.access` is the pitch's own rule (`null` = uses the venue's); use `pitch.effectiveAccess` for display. 404 unless both the venue and the pitch are published.

### Location suggest: `GET /api/locations/suggest?q=`

```sh
curl -s "$FF/api/locations/suggest?q=Brunswick"
```

```json
{
  "suggestions": [
    {
      "id": "dXJuOm1ieHBsYzpFeGFtcGxl",
      "name": "Brunswick",
      "label": "Brunswick, Victoria 3056, Australia",
      "type": "locality",
      "latitude": -37.767,
      "longitude": 144.96
    }
  ]
}
```

`q` is 2–80 characters of letters, digits, spaces and common address punctuation. Up to 5 Australian results, biased towards Melbourne, with coordinates rounded to 3 decimal places. Responses are never cached (Mapbox's terms for temporary geocoding), so debounce in the client. A Mapbox outage is a 503.

## Admin API

For curating data. Operators: see [admin-operations.md](admin-operations.md) for minting tokens and the publishing workflow.

### Authentication

```sh
export FF_ADMIN_TOKEN=ffadm_…   # from `pnpm admin:credential mint`; never commit or paste it anywhere
curl -s -H "Authorization: Bearer $FF_ADMIN_TOKEN" "$FF/api/admin/venues/5eed0000-0000-4000-8000-000000000001"
```

The token goes in the `Authorization` header only; a token in the query string is rejected. Each route needs one scope:

| Scope             | Routes                                                                  |
| ----------------- | ----------------------------------------------------------------------- |
| `venues:write`    | create, read and update venues; record verifications                    |
| `pitches:write`   | create, read and update pitches                                         |
| `media:write`     | upload, read and update images                                          |
| `content:publish` | every `publish`, `unpublish` and `archive` (venues, pitches and images) |

### Versions: `ETag` and `If-Match`

Every admin read and write returns the record's version as a strong `ETag` (also `version` in the body). Every change to an existing record (PATCH, publish, unpublish, archive) must send it back in `If-Match`. If someone changed the record since you read it, you get a **409**: read it again, check the change still makes sense, and retry with the new ETag.

```sh
curl -s -X PATCH "$FF/api/admin/venues/5eed0000-0000-4000-8000-000000000001" \
  -H "Authorization: Bearer $FF_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "1761989400000000"' \
  --data '{"postcode":"3056","amenities":{"cafe":"no"}}'
```

In a PATCH, an absent field is unchanged and `null` clears an optional one back to "not confirmed". Amenities take `"yes"`, `"no"` or `"unknown"`.

### Retries: `Idempotency-Key`

Optional on every admin write. Send a unique key (8–128 characters: letters, digits, `_ . : -`). If the request succeeds, its response is stored for 24 hours; a retry with the same key and the same request gets that stored response, marked `Idempotent-Replayed: true`, without changing anything again. The same key with a different request is a **422**. Failed requests aren't stored, so you can retry them with the same key.

```sh
curl -s -X POST "$FF/api/admin/venues" \
  -H "Authorization: Bearer $FF_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: import-2026-11-11-venue-0001' \
  --data '{"slug":"wattlebird-reserve","name":"Wattlebird Reserve","suburb":"Brunswick","state":"VIC","latitude":-37.7671,"longitude":144.9602}'
```

201, with `ETag` and `Location: /api/admin/venues/{id}`.

### Unused images

`GET /api/admin/media?unused=true` (`media:write`) lists images that aren't shown anywhere public, with `unusedReason` (see [admin-operations.md](admin-operations.md#images)). `unused=true` is required: it isn't a general listing. `limit` is 1–100 (default 50); pass `nextCursor` back as `cursor`. Every admin image response also carries `unused` and `unusedReason`.

### Upload an image

`multipart/form-data`, one `file` (JPEG, PNG, WebP or AVIF, up to 10 MB) plus text fields. The image is re-encoded to WebP with all metadata (EXIF, GPS) removed, and stored privately as a draft.

```sh
curl -s -X POST "$FF/api/admin/media" \
  -H "Authorization: Bearer $FF_ADMIN_TOKEN" \
  -F 'file=@north-pitch.jpg;type=image/jpeg' \
  -F 'venueId=5eed0000-0000-4000-8000-000000000001' \
  -F 'altText=Main pitch at Wattlebird Reserve, looking north' \
  -F 'rightsBasis=owned' -F 'evidenceRef=drive/photos/2026-11-01' -F 'commercialUseOk=true'
```

Give exactly one of `venueId` or `pitchId`. In multipart, `commercialUseOk` is `true` or `false`, and an empty field means `null`.

### Publish, unpublish, archive

All need `content:publish` and `If-Match`. The body is optional except for venue publish, and may carry a `reason` (up to 500 characters) for the audit log.

```sh
curl -s -X POST "$FF/api/admin/venues/5eed0000-0000-4000-8000-000000000001/publish" \
  -H "Authorization: Bearer $FF_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "1761989400000000"' \
  --data '{"pitches":[{"id":"5eed0000-0000-4000-8000-000000000101","version":"1761989460000000"}],"reason":"Verified on site"}'
```

Venue publish lists the pitches to publish with it, each with the version you reviewed. The order of operations and the rules for each step are in [admin-operations.md](admin-operations.md#publish-a-new-venue).

## Changing the API

1. Change the route and its Zod schema, and the DTO if the response changes.
2. If the response changed, update the matching schema in `src/lib/openapi/responses.ts`. `pnpm typecheck` fails until the schema and the DTO agree.
3. A new route needs an entry in `src/lib/openapi/document.ts`. `pnpm test` fails if any route under `src/app/api` isn't documented.
4. Run `pnpm openapi:generate` and commit `docs/api/openapi.json`. `pnpm test` (and so CI) fails while the committed file is out of date.
5. Update this page if a convention changed.

Examples in `document.ts` are checked against their schemas whenever the document is built, so they can't show a request the API would reject.
