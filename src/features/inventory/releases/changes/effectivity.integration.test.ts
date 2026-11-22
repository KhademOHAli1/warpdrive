import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { assert, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { makeTestDb } from "@/test/db";
import { inventoryItems } from "../../schema";
import { actor } from "../../warehouse/operations/structures.test-helpers";
import { inventoryProductReleases, inventoryReleaseArtifacts } from "../schema";
import type { ChangeReview } from "./contracts";
import { readEngineeringReleasePolicy } from "./effectivity";
import {
  inventoryEngineeringChanges as changes,
  inventoryEngineeringEvents as events,
  inventoryEngineeringRequests as requests,
} from "./schema";

const fingerprint = "5".repeat(64);

async function seedExactDraft(tx: Db, itemId: string, revision: string, actorId: string) {
  const id = randomUUID();
  await tx.insert(inventoryProductReleases).values({ id, itemId, revision, createdBy: actorId });
  const fields = {
    releaseId: id,
    sizeBytes: 1,
    etag: "test",
    sha256: fingerprint,
    createdBy: actorId,
    state: "ready",
  } as const;
  await tx.insert(inventoryReleaseArtifacts).values([
    {
      ...fields,
      kind: "pcbFabrication",
      name: "fabrication.zip",
      contentType: "application/zip",
      objectKey: `${id}/fab`,
    },
    {
      ...fields,
      kind: "manufacturingBom",
      name: "materials.csv",
      contentType: "text/csv",
      objectKey: `${id}/bom`,
      bomEntries: [{ sku: "CUTOVER-PART", quantity: 2 }],
    },
  ]);
  return id;
}

function sealDraft(tx: Db, releaseId: string, actorId: string, partId: string) {
  return tx
    .update(inventoryProductReleases)
    .set({
      status: "released",
      approvedBy: actorId,
      approvedAt: sql`clock_timestamp()`,
      bom: [{ itemId: partId, sku: "CUTOVER-PART", name: "Test part", quantity: 2 }],
    })
    .where(eq(inventoryProductReleases.id, releaseId));
}

test("managed release selection uses fresh database time and retains exact immutable submitted evidence", async () => {
  const h = await makeTestDb();
  try {
    const operator = await actor(h, "Change test operator", true);
    const actorId = operator.userId;
    const itemId = randomUUID();
    const partId = randomUUID();
    await h.db.insert(inventoryItems).values([
      { id: itemId, sku: "CUTOVER-PRODUCT", name: "Test unit", kind: "product", revision: "A" },
      { id: partId, sku: "CUTOVER-PART", name: "Test part", kind: "component", revision: "A" },
    ]);
    const baseReleaseId = await seedExactDraft(h.db, itemId, "A", actorId);
    const candidateReleaseId = await seedExactDraft(h.db, itemId, "B", actorId);
    await sealDraft(h.db, baseReleaseId, actorId, partId);
    expect(await readEngineeringReleasePolicy(h.db, itemId)).toMatchObject({
      managed: false,
      releaseId: null,
    });
    const changeId = randomUUID();
    const requestId = randomUUID();
    const review: ChangeReview = {
      base: { id: baseReleaseId, revision: "A", status: "released" },
      candidate: { id: candidateReleaseId, revision: "B", status: "draft" },
      fingerprint,
      ready: true,
      design: [],
      materials: [],
      whereUsed: [],
    };
    const submitted = {
      id: changeId,
      itemId,
      baseReleaseId,
      candidateReleaseId,
      review,
      fingerprint,
      createdBy: actorId,
      reason: "Scheduled revision B",
      effectiveAt: sql`clock_timestamp() + interval '3 seconds'`,
    };
    await expect(h.db.insert(changes).values(submitted)).rejects.toMatchObject({
      cause: { code: "23514" },
    });
    expect(await readEngineeringReleasePolicy(h.db, itemId)).toMatchObject({
      managed: false,
      releaseId: null,
    });

    await h.db.transaction(async (tx) => {
      await tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(eq(inventoryItems.id, itemId))
        .for("update");
      const [row] = await tx
        .insert(changes)
        .values(submitted)
        .returning({ effectiveAt: changes.effectiveAt });
      assert(row !== undefined);
      await tx.insert(events).values({
        changeId,
        version: 1,
        type: "submitted",
        review,
        actorId,
        actorName: "Change test operator",
      });
      expect(await readEngineeringReleasePolicy(tx, itemId)).toMatchObject({
        managed: true,
        releaseId: baseReleaseId,
      });
      await sealDraft(tx, candidateReleaseId, actorId, partId);
      await tx
        .update(changes)
        .set({
          status: "approved",
          version: 2,
          approvedBy: actorId,
          approvedAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(changes.id, changeId));
      await tx.insert(events).values({
        changeId,
        version: 2,
        type: "approved",
        actorId,
        actorName: "Change test operator",
      });
      await tx.insert(requests).values({ changeId, requestId, itemId, actorId, fingerprint });
      const before = await readEngineeringReleasePolicy(tx, itemId);
      expect(before).toMatchObject({ managed: true, releaseId: baseReleaseId });
      expect(Date.parse(before.observedAt)).toBeLessThan(row.effectiveAt.getTime());
      // Both reads share one transaction and the same product lock. Only a fresh
      // database clock can move the selected release across the scheduled cutover.
      await tx.execute(
        sql`SELECT pg_sleep(greatest(extract(epoch from ${row.effectiveAt.toISOString()}::timestamptz - clock_timestamp()), 0) + 0.020)`,
      );
      const after = await readEngineeringReleasePolicy(tx, itemId);
      expect(after).toMatchObject({ managed: true, releaseId: candidateReleaseId });
      expect(Date.parse(after.observedAt)).toBeGreaterThanOrEqual(row.effectiveAt.getTime());
    });

    await expect(
      h.pool.query(
        "UPDATE public.inventory_engineering_events SET actor_name = 'changed' WHERE change_id = $1",
        [changeId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      h.pool.query(
        "UPDATE public.inventory_engineering_changes SET reason = 'changed', version = 3 WHERE id = $1",
        [changeId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      h.pool.query("DELETE FROM public.inventory_engineering_requests WHERE request_id = $1", [
        requestId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await readEngineeringReleasePolicy(h.db, itemId)).toMatchObject({
      managed: true,
      releaseId: candidateReleaseId,
    });
  } finally {
    await h.close();
  }
});
