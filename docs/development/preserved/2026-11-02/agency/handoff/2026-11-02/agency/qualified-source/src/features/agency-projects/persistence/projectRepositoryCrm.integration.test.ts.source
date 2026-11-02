import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deals } from "@/db/schema/deals";
import { persons } from "@/db/schema/persons";
import { seedPipelineWithStages } from "@/db/testing/factories";
import { projectCreateInputSchema } from "../projectCreationInput";
import { type ProjectSchemaFixture, schemaCase } from "./projectPersistence.seeds";
import { repositoryFixture, success } from "./projectRepository.test-support";

async function seedTerminalDeal(
  f: ProjectSchemaFixture,
  status: "won" | "lost",
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const { pipeline, stages } = await seedPipelineWithStages(f.db.db, ["Qualified", "Proposal"]);
  signal.throwIfAborted();
  const stage = stages[1];
  assert(stage);
  const [person] = await f.db.db
    .insert(persons)
    .values({
      name: "Existing client contact",
      ownerId: f.actorId,
      orgId: f.orgId,
      visibilityLevel: "all",
    })
    .returning();
  signal.throwIfAborted();
  assert(person);
  const terminalTime = new Date("2025-05-17T10:11:12.345Z");
  const [deal] = await f.db.db
    .insert(deals)
    .values({
      title: `Existing ${status} CRM deal`,
      status,
      ownerId: f.actorId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      personId: person.id,
      orgId: f.orgId,
      visibilityLevel: "all",
      value: "48750.25",
      currency: "EUR",
      wonTime: status === "won" ? terminalTime : null,
      lostTime: status === "lost" ? terminalTime : null,
      lostReason: status === "lost" ? "Client deferred" : null,
    })
    .returning();
  signal.throwIfAborted();
  assert(deal);
  return deal;
}

async function readDeal(f: ProjectSchemaFixture, dealId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const [deal] = await f.db.db.select().from(deals).where(eq(deals.id, dealId));
  signal.throwIfAborted();
  assert(deal);
  return deal;
}

// Real CRM persistence only. Injected admissions and synthetic HMAC do not prove native authority or crypto.
describe("Agency project links preserve existing terminal CRM deals", () => {
  it.each(["won", "lost"] as const)(
    "creates, reads and starts a project without changing its existing %s deal",
    (status) =>
      schemaCase(async (f) => {
        const seeded = await seedTerminalDeal(f, status, f.signal);
        const before = await readDeal(f, seeded.id, f.signal);
        expect(before).toMatchObject({
          id: seeded.id,
          status,
          ownerId: f.actorId,
          personId: seeded.personId,
          orgId: f.orgId,
          pipelineId: seeded.pipelineId,
          stageId: seeded.stageId,
          currency: "EUR",
          wonTime: status === "won" ? new Date("2025-05-17T10:11:12.345Z") : null,
          lostTime: status === "lost" ? new Date("2025-05-17T10:11:12.345Z") : null,
        });
        const { repository } = repositoryFixture(f);
        const created = success(
          await repository.create(
            projectCreateInputSchema.parse({
              intentId: randomUUID(),
              ownerUserId: f.ownerId,
              title: `Project linked to ${status} deal`,
              dealId: before.id,
              personId: before.personId,
              orgId: before.orgId,
            }),
            f.signal,
          ),
        );
        expect(success(await repository.read(created.projectId, f.signal))).toMatchObject({
          dealId: before.id,
          personId: before.personId,
          orgId: before.orgId,
          ownerUserId: f.ownerId,
          state: "planned",
          revision: 0,
        });
        expect(
          success(
            await repository.start(
              { projectId: created.projectId, intentId: randomUUID(), expectedRevision: 0 },
              f.signal,
            ),
          ),
        ).toEqual({ projectId: created.projectId, revision: 1 });
        expect(success(await repository.read(created.projectId, f.signal))).toMatchObject({
          dealId: before.id,
          personId: before.personId,
          orgId: before.orgId,
          state: "active",
          revision: 1,
        });
        // Whole-row equality includes status, both terminal timestamps, owner, CRM IDs,
        // pipeline/stage, value/currency, updatedAt and every other native deal field.
        expect(await readDeal(f, before.id, f.signal)).toEqual(before);
      })(),
  );
});
