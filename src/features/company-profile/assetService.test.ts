import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it } from "vitest";
import { seedUser } from "@/db/testing/factories";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, ok } from "@/types/result";
import { CompanyAssetService } from "./assetService";
import type { CompanyAssetStorage } from "./assetStorage";
import { assetUploadResultSchema } from "./contracts";
import { companyAssets } from "./schema";
import { CompanyService } from "./service";

let h: TestDb, actor: PermSetUser;
let objects: Map<string, Buffer>;
let storage: CompanyAssetStorage;
const signal = () => AbortSignal.timeout(10000);
beforeEach(async () => {
  h = await makeTestDb();
  const user = await seedUser(h.db, { isAdmin: true });
  actor = { id: user.id, isActive: true, type: "admin", flags: new Set(), groupIds: new Set() };
  objects = new Map();
  // Object-store adapter only. All authorization, asset pointers and receipts use actual Postgres.
  storage = {
    put(key, bytes) {
      objects.set(key, bytes);
      return Promise.resolve(ok(undefined));
    },
    read(key, size, digest) {
      const bytes = objects.get(key);
      return Promise.resolve(
        bytes &&
          bytes.length === size &&
          createHash("sha256").update(bytes).digest("hex") === digest
          ? ok(bytes)
          : err("storage_unavailable"),
      );
    },
  };
});
afterEach(async () => h.close());
const run = <T>(fn: (assets: CompanyAssetService, company: CompanyService) => Promise<T>) =>
  withCurrentAuthority(h.db, "read", signal(), (tx) =>
    fn(new CompanyAssetService(tx, storage, signal()), new CompanyService(tx, signal())),
  );
const image = (color = "#ffffff") =>
  sharp({ create: { width: 20, height: 20, channels: 4, background: color } })
    .png()
    .toBuffer();

it("keeps draft assets private, applies approved immutable pointer, then withdraws member access", async () => {
  const requestId = randomUUID(),
    bytes = await image();
  const result = await run((a) => a.upload(actor, requestId, "icon", bytes));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const uploaded = assetUploadResultSchema.parse(result.value);
  const member = { ...actor, type: "regular" as const, flags: new Set<never>() };
  expect(await run((a) => a.read(member, uploaded.assetId))).toMatchObject({
    ok: false,
    error: { code: "not_found" },
  });
  expect(
    (
      await run((_, c) =>
        c.execute(actor, {
          action: "save_branding",
          requestId: randomUUID(),
          expectedRevision: 0,
          branding: {
            iconAssetId: uploaded.assetId,
            logoAssetId: null,
            accentColor: null,
            fit: "contain",
          },
        }),
      )
    ).ok,
  ).toBe(true);
  expect((await run((a) => a.read(member, uploaded.assetId))).ok).toBe(true);
  expect(
    (
      await run((_, c) =>
        c.execute(actor, {
          action: "save_branding",
          requestId: randomUUID(),
          expectedRevision: 1,
          branding: { iconAssetId: null, logoAssetId: null, accentColor: null, fit: "contain" },
        }),
      )
    ).ok,
  ).toBe(true);
  expect(await run((a) => a.read(member, uploaded.assetId))).toMatchObject({
    ok: false,
    error: { code: "not_found" },
  });
  expect((await run((a) => a.read(actor, uploaded.assetId))).ok).toBe(true);
  expect(await h.db.select().from(companyAssets)).toHaveLength(1);
  expect(objects.size).toBe(1);
});

it("reconciles upload UUID and rejects changed bytes, actors and wrong branding slots", async () => {
  const requestId = randomUUID(),
    bytes = await image();
  const first = await run((a) => a.upload(actor, requestId, "logo", bytes));
  if (!first.ok) throw new Error("fixture upload failed");
  expect(await run((a) => a.upload(actor, requestId, "logo", bytes))).toEqual(first);
  expect(await run((a) => a.operation(actor, requestId))).toEqual(first);
  expect(await run((a) => a.operation({ ...actor, id: randomUUID() }, requestId))).toMatchObject({
    ok: false,
    error: { code: "not_found" },
  });
  const changed = await image("#000000");
  expect(await run((a) => a.upload(actor, requestId, "logo", changed))).toMatchObject({
    ok: false,
    error: { code: "replay_conflict" },
  });
  expect(
    await run((_, c) =>
      c.execute(actor, {
        action: "save_branding",
        requestId: randomUUID(),
        expectedRevision: 0,
        branding: {
          iconAssetId: first.value.assetId,
          logoAssetId: null,
          accentColor: null,
          fit: "contain",
        },
      }),
    ),
  ).toMatchObject({ ok: false, error: { code: "asset_invalid" } });
  expect(await h.db.select().from(companyAssets)).toHaveLength(1);
});
