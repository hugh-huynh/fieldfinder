import { describe, expect, it } from "vitest";

import { createMemoryMediaStore } from "@/lib/storage/memory";
import { assertObjectKey, PUBLIC_BUCKET } from "@/lib/storage/types";

import type { AdminMediaDto } from "./admin-dto";
import { fieldsFromForm, mediaPatchSchema, mediaUploadSchema } from "./admin-schema";
import { publishBlocker } from "./admin-service";

// Admin media rules that need no database (PR 2.12). End to end in tests/integration/admin-media.test.ts.

const VENUE = "5eed0000-0000-4000-8000-000000000001";
const PITCH = "5eed0000-0000-4000-8001-000000000001";

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  f.append("file", new File([new Uint8Array([1])], "x.jpg", { type: "image/jpeg" }));
  for (const [name, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) f.append(name, v);
  }
  return f;
}

describe("upload fields", () => {
  it("turns multipart strings into typed values and ignores the file", () => {
    const fields = fieldsFromForm(
      form({ venueId: VENUE, altText: "Goalmouth", displayOrder: "2", commercialUseOk: "true", author: "" }),
    );
    expect(fields).toEqual({
      venueId: VENUE,
      altText: "Goalmouth",
      displayOrder: 2,
      commercialUseOk: true,
      author: null,
    });
    expect(mediaUploadSchema.safeParse(fields).success).toBe(true);
  });

  it.each([
    ["no owner", { altText: "x" }],
    ["two owners", { venueId: VENUE, pitchId: PITCH, altText: "x" }],
    ["no alt text", { venueId: VENUE }],
    ["blank alt text", { venueId: VENUE, altText: "   " }],
    ["alt text over 300 characters", { venueId: VENUE, altText: "x".repeat(301) }],
    ["an unknown field", { venueId: VENUE, altText: "x", status: "published" }],
    ["a repeated field", { venueId: VENUE, altText: ["x", "y"] }],
    ["a non-boolean commercialUseOk", { venueId: VENUE, altText: "x", commercialUseOk: "yes" }],
    ["a negative display order", { venueId: VENUE, altText: "x", displayOrder: "-1" }],
    ["an unknown rights basis", { venueId: VENUE, altText: "x", rightsBasis: "found_online" }],
    ["a non-http source URL", { venueId: VENUE, altText: "x", sourceUrl: "javascript:alert(1)" }],
  ])("rejects %s", (_name, fields) => {
    expect(mediaUploadSchema.safeParse(fieldsFromForm(form(fields))).success).toBe(false);
  });

  it("patch accepts any subset of the editable fields, nothing else", () => {
    expect(mediaPatchSchema.safeParse({ altText: "New alt" }).success).toBe(true);
    expect(mediaPatchSchema.safeParse({ rightsBasis: null }).success).toBe(true);
    expect(mediaPatchSchema.safeParse({ publicKey: "p/x.webp" }).success).toBe(false);
    expect(mediaPatchSchema.safeParse({ venueId: VENUE }).success).toBe(false);
  });
});

describe("publishBlocker (mirrors the 0002 publish gate)", () => {
  const media = (rights: Partial<AdminMediaDto["rights"]>): AdminMediaDto => ({
    id: "m",
    venueId: VENUE,
    pitchId: null,
    contentType: "image/webp",
    width: 1,
    height: 1,
    byteSize: 1,
    alt: "x",
    displayOrder: 0,
    status: "draft",
    publicUrl: null,
    createdAt: "",
    updatedAt: "",
    version: "1",
    unused: true,
    unusedReason: "image_draft",
    rights: {
      basis: "owned",
      author: null,
      sourceUrl: null,
      licenseName: null,
      licenseUrl: null,
      attributionText: null,
      evidenceRef: "evidence/site-visit-2026-10",
      commercialUseOk: true,
      ...rights,
    },
  });
  const ccBy = {
    basis: "cc_by" as const,
    author: "Example Photographer",
    sourceUrl: "https://example.org/p/1",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText: "Photo: Example Photographer, CC BY 4.0",
  };

  it("passes complete rights", () => {
    expect(publishBlocker(media({}))).toBeNull();
    expect(publishBlocker(media(ccBy))).toBeNull();
    expect(publishBlocker(media({ basis: "cc0_public_domain", sourceUrl: "https://example.org/p/2" }))).toBeNull();
  });

  it.each([
    ["no rights basis", { basis: null }],
    ["commercial use not allowed", { commercialUseOk: false }],
    ["commercial use unknown", { commercialUseOk: null }],
    ["no evidence", { evidenceRef: null }],
    ["blank evidence", { evidenceRef: "  " }],
    ["public domain without a source", { basis: "cc0_public_domain" as const }],
    ["CC BY without attribution", { ...ccBy, attributionText: null }],
    ["a non-commercial licence", { ...ccBy, licenseName: "CC BY-NC 4.0" }],
    ["a 'non-commercial' licence by name", { ...ccBy, licenseName: "Non-commercial use only" }],
  ])("blocks %s", (_name, rights) => {
    expect(publishBlocker(media(rights))).not.toBeNull();
  });
});

describe("storage keys", () => {
  it("accept the keys the app generates and refuse traversal", async () => {
    expect(() => {
      assertObjectKey("u/0b1c2d3e-0000-4000-8000-000000000001.webp");
    }).not.toThrow();
    expect(() => {
      assertObjectKey("p/AbC_-xYz0123456789abcdefABCDEF0123456789ab.webp");
    }).not.toThrow();
    for (const bad of ["../secret", "u/../x", "/abs", "a b", "x.webp", ""]) {
      expect(() => {
        assertObjectKey(bad);
      }, bad).toThrow();
    }
    const store = createMemoryMediaStore();
    await expect(store.put(PUBLIC_BUCKET, "../escape", new Uint8Array([1]), "image/webp")).rejects.toThrow();
  });
});
