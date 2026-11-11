# Admin operations runbook

How to curate FieldFinder's data through the admin API: tokens, adding and publishing venues, images, and taking things down. Request and response details are in [README.md](README.md) and [openapi.json](openapi.json). Every example value here is fake.

- [Before you start](#before-you-start)
- [Admin tokens](#admin-tokens)
- [Publish a new venue](#publish-a-new-venue)
- [Edit published data](#edit-published-data)
- [Images](#images)
- [Take something down](#take-something-down)
- [When a request fails](#when-a-request-fails)
- [Incidents](#incidents)

## Before you start

```sh
export FF=https://fieldfinder.example        # the deployment you're working on
export FF_ADMIN_TOKEN=ffadm_…                # see "Admin tokens"; keep it out of shell history if you can
H=(-H "Authorization: Bearer $FF_ADMIN_TOKEN")
```

The examples use `curl "${H[@]}" …` so the token is typed once. Preview deployments are behind Vercel's deployment protection; use `vercel curl <path> --deployment <preview URL>` there.

Ground rules:

- **Never invent data.** Leave a field out, or set it to `null`, when it isn't confirmed. The site shows "Not confirmed" and filters never match it. A guessed "yes" is worse than an honest unknown.
- **Read before you write.** Every change to an existing record needs its current ETag in `If-Match`, so you always act on what you last saw.
- **Use an `Idempotency-Key`** on writes you might retry (scripts, flaky connections). A retry then can't create a duplicate.
- Everything is audited: every change writes a revision with your token's label and the request id.

## Admin tokens

Tokens are minted on the operator's machine with the credential CLI, which connects with `DATABASE_URL_OPERATOR` (the project owner's connection string; never set in Vercel). Only the token's SHA-256 is stored. The token is printed **once** and can't be recovered.

```sh
# Least privilege: only the scopes the job needs, for as short as practical.
pnpm admin:credential mint --label hugh-curation-2026-11 --scopes venues:write,pitches:write,media:write --days 30
pnpm admin:credential mint --label hugh-publish-2026-11 --scopes content:publish --days 7
pnpm admin:credential mint --label import-script --scopes venues:write,pitches:write --days 1 --ip 203.0.113.7/32

pnpm admin:credential list                                  # labels, scopes, expiry, last used; never tokens
pnpm admin:credential rotate --from hugh-curation-2026-11 --label hugh-curation-2026-12   # new token, old one revoked
pnpm admin:credential revoke --label import-script
```

- The default lifetime is 90 days. Prefer shorter ones; mint a fresh token rather than keeping a long-lived one.
- Put the token straight into a password manager. Don't paste it into chat, tickets, commits, screenshots or `.env` files that get shared.
- `--ip` restricts a token to addresses or CIDR ranges (a 403 from anywhere else).
- Revoke a token as soon as its job is done (e.g. after an import or a smoke test).

| Scope             | Lets the token                                            |
| ----------------- | --------------------------------------------------------- |
| `venues:write`    | create, read and update venues; record verifications      |
| `pitches:write`   | create, read and update pitches                           |
| `media:write`     | upload, read and update images                            |
| `content:publish` | publish, unpublish and archive venues, pitches and images |

## Publish a new venue

Nothing is public until step 5. Until then, every record is a draft only admins can see.

**1. Create the venue** (`venues:write`). Save `venue.id` and the `ETag` from the response.

```sh
curl -s "${H[@]}" -X POST "$FF/api/admin/venues" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: wattlebird-venue-create' \
  --data '{"slug":"wattlebird-reserve","name":"Wattlebird Reserve","streetAddress":"1 Example Road","suburb":"Brunswick","state":"VIC","postcode":"3056","latitude":-37.7671,"longitude":144.9602,"access":"public","amenities":{"parking":"yes","toilets":"yes"}}'
```

- The slug becomes the public URL (`/venues/wattlebird-reserve`). Lowercase letters, digits and single hyphens. **It can't change once the venue has been published**, so get it right now.
- Coordinates are the venue's real location (they're shown on the map and used for distance).

**2. Record a verification** (`venues:write`). Publishing needs at least one. This is internal provenance and never public.

```sh
curl -s "${H[@]}" -X POST "$FF/api/admin/venues/$VENUE_ID/verifications" -H 'Content-Type: application/json' \
  --data '{"verifiedBy":"Field team","verifiedOn":"2026-11-01","confidence":"high","evidence":"Site visit; photos in the team drive"}'
```

`verifiedOn` can't be in the future. `evidence` and `internalNotes` are for pointers and notes, not copies of private documents.

**3. Add the pitches** (`pitches:write`), one request each. Save each `pitch.id` and `pitch.version`.

```sh
curl -s "${H[@]}" -X POST "$FF/api/admin/venues/$VENUE_ID/pitches" -H 'Content-Type: application/json' \
  --data '{"slug":"north-pitch","name":"North Pitch","surface":"grass","pitchFormat":"full","lengthMeters":100,"widthMeters":64}'
```

Leave out what you haven't confirmed (`floodlights`, dimensions…). Dimensions are metres with at most one decimal place. Leave `access` out or `null` to use the venue's rule.

**4. Review.** Read the venue and each pitch back and check them against your source:

```sh
curl -s "${H[@]}" "$FF/api/admin/venues/$VENUE_ID"
curl -s "${H[@]}" "$FF/api/admin/pitches/$PITCH_ID"
```

Note the venue's `ETag` and each pitch's `version` **from this review**. Publishing with them guarantees you publish exactly what you reviewed: if anything changed since, publishing is a 409.

**5. Publish** (`content:publish`) the venue with the pitches that are ready. Draft pitches you leave out stay drafts; a pitch that is already published stays published whether or not you list it (see [Take something down](#take-something-down)).

```sh
curl -s "${H[@]}" -X POST "$FF/api/admin/venues/$VENUE_ID/publish" -H 'Content-Type: application/json' \
  -H "If-Match: \"$VENUE_VERSION\"" \
  --data "{\"pitches\":[{\"id\":\"$PITCH_ID\",\"version\":\"$PITCH_VERSION\"}],\"reason\":\"Verified on site 2026-11-01\"}"
```

The venue is now in search and at `/venues/wattlebird-reserve` (allow up to a minute for the edge cache). A venue with exactly one published pitch links straight to the pitch page.

**6. Add images** if you have them: see [Images](#images).

**Later pitches:** create them as in step 3, then publish each on its own with `POST /api/admin/pitches/{id}/publish` (`If-Match` = the pitch's ETag). That only works once the venue is published.

## Edit published data

`PATCH` the venue or pitch with its current ETag. Changes go live immediately (allow up to a minute, plus up to five more minutes while caches revalidate).

```sh
ETAG=$(curl -s -D - -o /dev/null "${H[@]}" "$FF/api/admin/pitches/$PITCH_ID" | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r')
curl -s "${H[@]}" -X PATCH "$FF/api/admin/pitches/$PITCH_ID" -H 'Content-Type: application/json' \
  -H "If-Match: $ETAG" --data '{"floodlights":true}'
```

- Absent fields are unchanged. `null` clears a field back to "not confirmed".
- Venue `amenities` merge: only the keys you send change. Set one back to `"unknown"` to un-confirm it.
- Slugs of anything that has ever been published can't change (saved links and search engines rely on them).
- Archived records can't be edited.

## Images

Images are uploaded as private drafts and only become public when you publish them **and** their venue (or pitch) is published.

**Rights come first** ([ADR-0006](../architecture/decisions/ADR-0006-media-rights-and-storage.md)). Publishing is refused (409, with the reason) unless:

- `rightsBasis` is set: `owned`, `licensed`, `cc0_public_domain`, `cc_by`, `cc_by_sa` or `written_permission`;
- `commercialUseOk` is `true`, and the licence isn't a non-commercial one (NC);
- `evidenceRef` says where the proof is kept (a file path, ticket or email id; not the proof itself);
- public-domain images have a `sourceUrl`;
- CC BY and CC BY-SA images have `author`, `sourceUrl`, `licenseName`, `licenseUrl` and `attributionText`. The attribution is shown publicly with the image.

If you aren't sure you may use an image, don't upload it.

**1. Upload** (`media:write`). Alt text is required: describe what the image shows, for people who can't see it.

```sh
curl -s "${H[@]}" -X POST "$FF/api/admin/media" \
  -F 'file=@north-pitch.jpg;type=image/jpeg' -F "venueId=$VENUE_ID" \
  -F 'altText=Main pitch at Wattlebird Reserve, looking north' \
  -F 'rightsBasis=owned' -F 'evidenceRef=drive/photos/2026-11-01' -F 'commercialUseOk=true'
```

Use `pitchId` instead of `venueId` for a pitch's own photo. JPEG, PNG, WebP or AVIF up to 10 MB. The stored copy is re-encoded to WebP with all metadata (camera, GPS) removed, so it's fine to upload photos straight from a phone.

**2. Complete the rights** later if needed with `PATCH /api/admin/media/{id}` (`If-Match` required). `displayOrder` (0 first) and `altText` can be changed the same way.

**3. Publish** (`content:publish`) with `POST /api/admin/media/{id}/publish` and the image's ETag. This copies it to public storage under a new, unguessable URL.

Publish images after their venue is live. A published image's URL works as soon as it's published, but the API only lists it once its venue (or pitch) is public.

**Retention.** Unpublishing or archiving keeps the image record, its rights evidence and its private original; only the public copy is deleted. A later ticket adds a way to flag such images as unused.

## Take something down

All of these need `content:publish` and the record's ETag in `If-Match`. Add a `reason` for the audit log.

| Action                                   | Effect                                                                                                                                                                                                  | Undo?                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `POST /api/admin/venues/{id}/unpublish`  | Only the venue goes back to draft; it and all its pitches disappear from search and pages. The pitches keep their own status (see below). The public copies of its and its pitches' images are deleted. | Yes: publish again           |
| `POST /api/admin/pitches/{id}/unpublish` | The pitch goes back to draft; its images' public copies are deleted. If it was the venue's last published pitch, the venue disappears too until another is published.                                   | Yes: publish again           |
| `POST /api/admin/media/{id}/unpublish`   | The public copy is deleted, so the old URL stops working. The image becomes a draft.                                                                                                                    | Yes: publish again (new URL) |
| `POST /api/admin/venues/{id}/archive`    | Archives the venue and all its pitches, and withdraws their images.                                                                                                                                     | **No, final**                |
| `POST /api/admin/pitches/{id}/archive`   | Archives the pitch and withdraws its images.                                                                                                                                                            | **No, final**                |

**Republishing a venue brings back the pitches that were published before**, even if the publish request doesn't list them: unpublishing the venue hides its pitches but doesn't change their status. To keep a pitch hidden after the venue returns, unpublish (or archive) that pitch before republishing the venue. Images don't come back on their own: they stay drafts until you publish each one again.

There's no delete (spec §5): records are kept for the audit trail. Prefer unpublish unless the place is gone for good.

Public pages can stay in the edge cache for up to a minute (plus up to five minutes of revalidation). The storage CDN may also serve a deleted image briefly. For anything urgent, such as an image you must not show, unpublish it and then check the old URL yourself.

## When a request fails

Read the `message`: it says what to fix. Quote the `requestId` when asking for help; it finds the request in the logs.

| Status | Usual cause                                                      | What to do                                                                                    |
| ------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 400    | A field failed validation, or `If-Match` is missing              | Fix the named fields. Unknown fields are rejected, so check spelling.                         |
| 401    | Token missing, mistyped, expired or revoked                      | Check the header is `Authorization: Bearer ffadm_…`; mint a new token if expired.             |
| 403    | The token lacks this route's scope, or the IP isn't allowed      | Use a token with the right scope (see the table above).                                       |
| 404    | Wrong id, or the venue a pitch or image belongs to doesn't exist | Check the id.                                                                                 |
| 409    | Someone changed it since you read it, or the state forbids it    | Read it again, re-check, retry with the new ETag. The message names state problems.           |
| 422    | `Idempotency-Key` reused with a different request                | Use a new key for a new request.                                                              |
| 429    | Over the rate limit                                              | Wait `Retry-After` seconds. Ten bad tokens in a minute block your IP until that minute is up. |
| 5xx    | Server or dependency problem                                     | Retry later with the same `Idempotency-Key`; report the `requestId` if it persists.           |

## Incidents

**A token leaked** (committed, pasted, shared):

1. `pnpm admin:credential revoke --label <label>` right away. It stops working on the next request.
2. Check `pnpm admin:credential list` for its last use.
3. Review recent changes made with that label (the `field_revisions` and `field_publications` tables record the actor and request id), and unpublish anything you didn't intend.
4. Mint a replacement with the narrowest scopes needed. If it was committed, removing it from git history isn't enough: revoking is what makes it safe.

**Wrong data is live:** `PATCH` it if it's a simple correction; unpublish the venue or pitch if it shouldn't be shown at all while you check.

**An image must come down now** (rights complaint, privacy): unpublish the image (or its venue), then load its old URL to confirm it no longer works. Record the complaint in `evidenceRef` or your tracker; don't delete the record.
