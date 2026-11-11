import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { persons } from "@/db/schema";
import { workflowV2Effects } from "@/db/schema/workflowV2";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { WorkflowV2Adapters, WorkflowV2Definition } from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { err } from "@/types/result";
import { startWorkflowV2 } from "./admission";
import { executeNewsletterWorkflowAction } from "./newsletterActions";
import { createWorkflowV2, publishWorkflowV2 } from "./persistence";
import { advanceWorkflowV2Run } from "./runner";

const transport = vi.hoisted(() => ({ invite: vi.fn(), person: vi.fn(), grants: vi.fn() }));
vi.mock("@/features/newsletter/identity/service", () => ({
  readPersonNewsletter: transport.person,
  readPersonNewsletterGrants: transport.grants,
  requestNewsletterInvite: transport.invite,
}));
const signal = () => AbortSignal.timeout(10_000);
const adapters: WorkflowV2Adapters = {
  native: () => Promise.resolve(err("unexpected_native")),
  external: (context, node, config) =>
    node.type === "NEWSLETTER_INVITE" || node.type === "NEWSLETTER_CONSENT_STATUS"
      ? executeNewsletterWorkflowAction(context, node.type, config)
      : Promise.resolve(err({ id: "unexpected_external" })),
  readiness: () => Promise.resolve({ state: "ready" }),
};

async function publishedNewsletterWorkflow(
  db: Db,
  actor: PermSetUser,
  personId: string,
  linkId: string,
  type: "NEWSLETTER_INVITE" | "NEWSLETTER_CONSENT_STATUS" = "NEWSLETTER_INVITE",
) {
  const definition: WorkflowV2Definition = {
    schemaVersion: 2,
    trigger: { type: "manual", config: { availability: "global" } },
    nodes: [
      {
        id: "invite",
        type,
        version: 1,
        name: "Invite",
        config: { personId, linkId, listId: 4 },
      },
    ],
    edges: [],
    entryNodeIds: ["invite"],
  };
  const draft = await createWorkflowV2(db, actor, { name: "Invite", definition }, signal());
  if (!draft.ok) throw new Error(draft.error);
  const published = await publishWorkflowV2(
    db,
    actor,
    { id: draft.value.id, expectedRevision: draft.value.revision },
    adapters,
    signal(),
  );
  if (!published.ok) throw new Error(published.error);
  return published.value.document.id;
}

async function start(db: Db, actor: PermSetUser, id: string, mode: "live" | "test") {
  const run = await startWorkflowV2(
    db,
    actor,
    { id, mode, requestKey: randomUUID() },
    adapters,
    signal(),
  );
  if (!run.ok) throw new Error(run.error);
  return run.value.id;
}

it("skips invitations in test mode and fences live effects with the stable worker receipt", async () => {
  transport.invite.mockReset().mockResolvedValueOnce({ id: randomUUID(), state: "unknown" });
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
    const linkId = randomUUID();
    await db.insert(persons).values({
      id: personId,
      name: "Consent fixture",
      ownerId: user.id,
      visibilityLevel: "all",
    });
    const workflowId = await publishedNewsletterWorkflow(db, actor, personId, linkId);
    const testRunId = await start(db, actor, workflowId, "test");
    expect((await advanceWorkflowV2Run(db, testRunId, adapters, signal())).status).toBe(
      "succeeded",
    );
    expect(transport.invite).not.toHaveBeenCalled();

    const liveRunId = await start(db, actor, workflowId, "live");
    await Promise.all([
      advanceWorkflowV2Run(db, liveRunId, adapters, signal()),
      advanceWorkflowV2Run(db, liveRunId, adapters, signal()),
    ]);
    const [effect] = await db
      .select()
      .from(workflowV2Effects)
      .where(eq(workflowV2Effects.runId, liveRunId));
    expect(effect?.status).toBe("unknown");
    expect(transport.invite).toHaveBeenCalledExactlyOnceWith(
      db,
      expect.objectContaining({ id: actor.id }),
      { operationId: effect?.effectKey, personId, linkId, listId: 4, originRunId: liveRunId },
      expect.any(AbortSignal),
    );
    expect((await advanceWorkflowV2Run(db, liveRunId, adapters, signal())).status).toBe("failed");
    expect(transport.invite).toHaveBeenCalledTimes(1);

    const revokedRunId = await start(db, actor, workflowId, "live");
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, personId));
    expect((await advanceWorkflowV2Run(db, revokedRunId, adapters, signal())).status).toBe(
      "failed",
    );
    expect(transport.invite).toHaveBeenCalledTimes(1);
  });
});

it("reports confirmed only for the current CRM purpose grant", async () => {
  const personId = randomUUID();
  const linkId = randomUUID();
  transport.person.mockReset().mockResolvedValue({
    personId,
    engineAvailable: true,
    addresses: [
      {
        address: "fixture@example.test",
        links: [
          {
            id: linkId,
            state: "verified",
            shared: false,
            consent: {
              status: "enabled",
              lists: [
                {
                  id: 4,
                  name: "Purpose",
                  optin: "double",
                  status: "active",
                  subscriptionStatus: "confirmed",
                },
              ],
            },
          },
        ],
      },
    ],
  });
  transport.grants
    .mockReset()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ bindingUuid: linkId }]);
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    await db.insert(persons).values({
      id: personId,
      name: "Consent fixture",
      ownerId: user.id,
      visibilityLevel: "all",
    });
    const workflowId = await publishedNewsletterWorkflow(
      db,
      actor,
      personId,
      linkId,
      "NEWSLETTER_CONSENT_STATUS",
    );
    for (const [state, confirmed] of [
      ["unverified", false],
      ["confirmed", true],
    ] as const) {
      const runId = await start(db, actor, workflowId, "live");
      expect((await advanceWorkflowV2Run(db, runId, adapters, signal())).status).toBe("succeeded");
      const [effect] = await db
        .select()
        .from(workflowV2Effects)
        .where(eq(workflowV2Effects.runId, runId));
      expect(effect?.output).toEqual({ state, confirmed, linkId });
    }
  });
});
