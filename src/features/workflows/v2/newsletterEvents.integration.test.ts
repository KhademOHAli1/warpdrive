import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { persons } from "@/db/schema";
import { workflowV2Runs } from "@/db/schema/workflowV2";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { WorkflowV2Adapters, WorkflowV2Definition } from "@/features/blocks/contracts";
import type { PersonNewsletterEvent } from "@/features/newsletter/identity/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { err } from "@/types/result";
import { admitNewsletterWorkflowEvent } from "./newsletterEvents";
import { createWorkflowV2, publishWorkflowV2 } from "./persistence";
import { advanceWorkflowV2Run } from "./runner";

const signal = () => AbortSignal.timeout(10_000);

async function publish(db: Db, actor: PermSetUser, listId: number, adapters: WorkflowV2Adapters) {
  const definition: WorkflowV2Definition = {
    schemaVersion: 2,
    trigger: { type: "newsletter.consent.confirmed", config: { listId } },
    nodes: [
      {
        id: "check",
        type: "FILTER",
        version: 1,
        name: "Check",
        config: { condition: { left: true, operator: "eq", right: true } },
      },
    ],
    edges: [],
    entryNodeIds: ["check"],
  };
  const created = await createWorkflowV2(
    db,
    actor,
    { name: "Consent event", definition },
    signal(),
  );
  if (!created.ok) throw new Error(created.error);
  const published = await publishWorkflowV2(
    db,
    actor,
    { id: created.value.id, expectedRevision: created.value.revision },
    adapters,
    signal(),
  );
  expect(published.ok).toBe(true);
}

it("admits a verified event once for its selected list and rechecks Person access on execution", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const personId = randomUUID();
    await db
      .insert(persons)
      .values({ id: personId, name: "Consent test", ownerId: user.id, visibilityLevel: "all" });
    const adapters: WorkflowV2Adapters = {
      native: () => Promise.resolve(err("unexpected_native")),
      external: () => Promise.resolve(err({ id: "unexpected_external" })),
      readiness: () => Promise.resolve({ state: "ready" }),
    };
    await publish(db, actor, 4, adapters);
    await publish(db, actor, 5, adapters);
    const event: PersonNewsletterEvent = {
      id: randomUUID(),
      personId,
      linkId: randomUUID(),
      listId: 4,
      event: "newsletter.consent.confirmed",
      occurredAt: new Date(Date.now() + 100),
      originRunId: null,
    };
    const [runId] = await admitNewsletterWorkflowEvent(db, adapters, event, signal());
    if (runId === undefined) throw new Error("Consent event was not admitted");
    expect(await admitNewsletterWorkflowEvent(db, adapters, event, signal())).toEqual([runId]);
    const runs = await db.select().from(workflowV2Runs);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger).toMatchObject({
      eventName: event.event,
      personId,
      linkId: event.linkId,
      listId: 4,
    });
    expect(Object.keys(runs[0]?.trigger ?? {}).sort()).toEqual(
      ["$workflowV2", "eventName", "linkId", "listId", "occurredAt", "personId"].sort(),
    );
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, personId));
    expect((await advanceWorkflowV2Run(db, runId, adapters, signal())).status).toBe("cancelled");
    expect(
      await admitNewsletterWorkflowEvent(db, adapters, { ...event, id: randomUUID() }, signal()),
    ).toEqual([]);
  });
});
