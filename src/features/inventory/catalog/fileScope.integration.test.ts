import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { users } from "@/db/schema";
import { confirmUpload, requestDownload, requestUpload } from "@/features/files/actions";
import { canActorAccessParent } from "@/features/files/fileAuthz";
import { listFilesForEntity } from "@/features/files/listFilesForEntity";
import { FakeStorageClient } from "@/features/files/storageFake";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { inventoryItems } from "../schema";
import { createLegacyPartProfile } from "./policy";
import { inventoryPartProfiles, inventoryPartStates } from "./schema";

it("inherits part visibility and blocks uploads for viewers and locked revisions", async () => {
  const { db, close } = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const actor = async (isAdmin: boolean): Promise<PermSetUser> => {
      const id = randomUUID();
      await db
        .insert(users)
        .values({ id, email: `${id}@example.test`, name: "File reviewer", isAdmin });
      return {
        id,
        isActive: true,
        type: isAdmin ? "admin" : "regular",
        flags: new Set(),
        groupIds: new Set(),
      };
    };
    const admin = await actor(true);
    const staff = await actor(false);
    const item = {
      id: randomUUID(),
      sku: "PART-FILE",
      name: "Part file",
      revision: "A",
      kind: "component",
    } as const;
    await db.insert(inventoryItems).values(item);
    expect(await createLegacyPartProfile(db, item)).toBe(true);

    const storage = new FakeStorageClient();
    const entityType = "inventory_item" as const;
    const input = {
      entityType,
      entityId: item.id,
      filename: "drawing.pdf",
      contentType: "application/pdf",
      size: 32,
    } as const;
    expect(await requestUpload(db, { actor: staff, storage, input }, signal)).toMatchObject({
      ok: false,
    });
    const started = await requestUpload(db, { actor: admin, storage, input }, signal);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const { fileId, post } = started.value;
    const key = post.fields.key;
    if (key === undefined || key === "") throw new Error("Expected a scoped upload key");
    storage.objectsByKey.set(key, { size: input.size, contentType: input.contentType });
    expect(await confirmUpload(db, { actor: admin, storage, fileId }, signal)).toEqual({
      ok: true,
      value: { status: "ready" },
    });
    expect(await canActorAccessParent(db, staff, entityType, item.id, signal)).toBe(true);
    expect(await listFilesForEntity(db, entityType, item.id, signal)).toMatchObject([
      { id: fileId, filename: input.filename },
    ]);
    expect(await requestDownload(db, { actor: staff, storage, fileId }, signal)).toMatchObject({
      ok: true,
    });

    const stateId = randomUUID();
    await db
      .insert(inventoryPartStates)
      .values({ id: stateId, code: "APPROVED", name: "Approved", active: true, locked: true });
    await db
      .update(inventoryPartProfiles)
      .set({ visibility: "admin", stateId })
      .where(eq(inventoryPartProfiles.itemId, item.id));
    expect(await canActorAccessParent(db, staff, entityType, item.id, signal)).toBe(false);
    expect(await requestDownload(db, { actor: staff, storage, fileId }, signal)).toMatchObject({
      ok: false,
    });
    expect(await requestDownload(db, { actor: admin, storage, fileId }, signal)).toMatchObject({
      ok: true,
    });
    expect(await requestUpload(db, { actor: admin, storage, input }, signal)).toMatchObject({
      ok: false,
    });
  } finally {
    await close();
  }
});
