import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getMediaRoute } from "@/app/api/admin/media/[id]/route";
import { GET as listRoute } from "@/app/api/admin/media/route";
import type { AdminMediaDto, UnusedReason } from "@/features/media/admin-dto";
import type { UnusedMediaPage } from "@/features/media/admin-service";
import type { ApiErrorBody } from "@/lib/api/errors";
import { generateToken, hashToken } from "@/lib/auth/token";
import { adminDb } from "@/lib/db/admin";

import { LOCAL_ADMIN_URL } from "../setup/integration-env";

import { loadTruth } from "./security/crawl";

// "Unused" images (PR 2.16, Hugh 2026-11-13: computed, list only). An image is unused when it isn't
// shown anywhere public; `unusedReason` says why, owner first. Each state is created directly with
// the owner connection, so the expectations don't depend on the fixtures.

const operator = postgres(LOCAL_ADMIN_URL, { max: 1, onnotice: () => undefined });
const run = randomUUID().slice(0, 8);
let token: string;
let noMedia: string;

async function mint(scopes: string[]): Promise<string> {
  const t = generateToken();
  await operator`
    insert into public.admin_api_credentials (label, token_hash, scopes, expires_at)
    values (${`unused-${run}-${randomUUID().slice(0, 6)}`}, ${hashToken(t)}, ${scopes}, now() + interval '1 day')
  `;
  return t;
}

type Status = "draft" | "published" | "archived";

async function venue(name: string, status: Status): Promise<string> {
  const [row] = await operator<{ id: string }[]>`
    insert into public.venues (slug, name, suburb, state, latitude, longitude, status)
    values (${`unused-${run}-${name}`}, ${`Unused test ${name}`}, 'Broome', 'WA', -17.962, 122.236, ${status})
    returning id::text
  `;
  return row?.id ?? "";
}

async function pitch(venueId: string, name: string, status: Status): Promise<string> {
  const [row] = await operator<{ id: string }[]>`
    insert into public.pitches (venue_id, slug, name, status)
    values (${venueId}::uuid, ${name}, ${`Pitch ${name}`}, ${status})
    returning id::text
  `;
  return row?.id ?? "";
}

/** An image row; a published one gets complete rights and a public key, as the publish gate needs. */
async function image(owner: { venueId?: string; pitchId?: string }, status: Status): Promise<string> {
  const key = `unused/${run}/${randomUUID()}.webp`;
  const published = status === "published";
  const [row] = await operator<{ id: string }[]>`
    insert into public.media_assets (venue_id, pitch_id, storage_key, public_key, content_type, width_px, height_px,
                                     byte_size, alt_text, status, rights_basis, evidence_ref, commercial_use_ok)
    values (${owner.venueId ?? null}::uuid, ${owner.pitchId ?? null}::uuid, ${key},
            ${published ? `p/${randomUUID()}.webp` : null}, 'image/webp', 10, 10, 100, 'Test image', ${status},
            ${published ? "owned" : null}, ${published ? `evidence/${run}` : null}, ${published ? true : null})
    returning id::text
  `;
  return row?.id ?? "";
}

/** Image id → the reason it should report (null = in use). */
const expected = new Map<string, UnusedReason | null>();

beforeAll(async () => {
  token = await mint(["media:write"]);
  noMedia = await mint(["venues:write", "pitches:write", "content:publish"]);

  // A public venue (published, with a published pitch) and its pitches in every state.
  const live = await venue("live", "published");
  const livePitch = await pitch(live, "live-pitch", "published");
  const draftPitch = await pitch(live, "draft-pitch", "draft");
  const archivedPitch = await pitch(live, "archived-pitch", "archived");
  expected.set(await image({ venueId: live }, "published"), null);
  expected.set(await image({ pitchId: livePitch }, "published"), null);
  expected.set(await image({ venueId: live }, "draft"), "image_draft");
  expected.set(await image({ venueId: live }, "archived"), "image_archived");
  expected.set(await image({ pitchId: draftPitch }, "published"), "owner_draft");
  expected.set(await image({ pitchId: archivedPitch }, "draft"), "owner_archived");

  // Published, but with no published pitch, so not public.
  const empty = await venue("empty", "published");
  await pitch(empty, "only-draft", "draft");
  expected.set(await image({ venueId: empty }, "published"), "owner_not_public");

  // A draft venue: its own image and its published pitch's image.
  const draft = await venue("draft", "draft");
  const pitchUnderDraft = await pitch(draft, "published-pitch", "published");
  expected.set(await image({ venueId: draft }, "published"), "owner_draft");
  expected.set(await image({ pitchId: pitchUnderDraft }, "published"), "owner_draft");

  // An archived venue: owner reasons win over the image's own state.
  const archived = await venue("archived", "archived");
  const pitchUnderArchived = await pitch(archived, "published-pitch", "published");
  expected.set(await image({ venueId: archived }, "draft"), "owner_archived");
  expected.set(await image({ pitchId: pitchUnderArchived }, "published"), "owner_archived");
});

afterAll(async () => {
  await operator`delete from public.media_assets where storage_key like ${`unused/${run}/%`}`;
  await operator`delete from public.pitches where venue_id in (select id from public.venues where slug like ${`unused-${run}-%`})`;
  await operator`delete from public.venues where slug like ${`unused-${run}-%`}`;
  await operator`delete from public.admin_api_credentials where label like ${`unused-${run}-%`}`;
  await operator.end({ timeout: 5 });
  await adminDb().end({ timeout: 5 });
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function list(query: string, t = token): Promise<Response> {
  return listRoute(new Request(`https://ff.test/api/admin/media?${query}`, { headers: auth(t) }), {
    params: Promise.resolve({}),
  });
}

/** Every unused image, following the cursor. */
async function listAll(limit: number): Promise<AdminMediaDto[]> {
  const items: AdminMediaDto[] = [];
  let cursor: string | null = null;
  for (let pageNo = 0; pageNo < 500; pageNo += 1) {
    const res = await list(`unused=true&limit=${String(limit)}${cursor === null ? "" : `&cursor=${cursor}`}`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as UnusedMediaPage;
    expect(page.items.length).toBeLessThanOrEqual(limit);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("the cursor never ended");
}

describe("unused and unusedReason on every admin image", () => {
  it("reports the right reason for each state, owner first, and null for images in use", async () => {
    for (const [id, reason] of expected) {
      const res = await getMediaRoute(new Request(`https://ff.test/api/admin/media/${id}`, { headers: auth(token) }), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(200);
      const { media } = (await res.json()) as { media: AdminMediaDto };
      expect({ unused: media.unused, unusedReason: media.unusedReason }, id).toEqual({
        unused: reason !== null,
        unusedReason: reason,
      });
    }
  });
});

describe("GET /api/admin/media?unused=true", () => {
  it("lists exactly the unused images, each once, in id order, across pages", async () => {
    const all = await listAll(2);
    const ids = all.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    for (const [id, reason] of expected) expect(ids.includes(id), id).toBe(reason !== null);
    expect(all.every((m) => m.unused && m.unusedReason !== null)).toBe(true);
  });

  it("agrees with the public views: unused is exactly 'not public', for every image in the database", async () => {
    const truth = await loadTruth();
    const listed = new Set((await listAll(100)).map((m) => m.id));
    for (const m of truth.media) expect(listed.has(m.id), m.id).toBe(!m.isPublic);
  });

  it("uses the default page size and never exceeds the maximum", async () => {
    const res = await list("unused=true");
    expect(res.status).toBe(200);
    expect(((await res.json()) as UnusedMediaPage).items.length).toBeLessThanOrEqual(50);
    expect((await list("unused=true&limit=100")).status).toBe(200);
  });

  it("never exposes a private storage key", async () => {
    const text = await (await list("unused=true&limit=100")).text();
    expect(text).not.toContain(`unused/${run}/`);
    expect(text).not.toContain("storageKey");
  });

  it.each([
    ["no unused parameter", ""],
    ["unused=false", "unused=false"],
    ["limit 0", "unused=true&limit=0"],
    ["limit 101", "unused=true&limit=101"],
    ["a malformed cursor", "unused=true&cursor=nope"],
    ["an unknown parameter", "unused=true&status=draft"],
    ["a repeated parameter", "unused=true&unused=true"],
  ])("400s %s", async (_name, query) => {
    const res = await list(query);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).code).toBe("invalid_request");
  });

  it("needs media:write", async () => {
    const res = await list("unused=true", noMedia);
    expect(res.status).toBe(403);
  });
});
