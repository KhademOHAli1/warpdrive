import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { deals, workflowRuns, workflows, workflowVersions } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { initialBlankDefinition } from "./editorModel";
import { createWorkflow } from "./persistence";
import { executableDefinition, executableNode } from "./readiness";
import { admitManualRun } from "./runAdmission";

const caseTimeout = 30_000;

function storedDefinition(
  schemaVersion: number | string,
  nodeVersion: number | string,
  delay: boolean,
) {
  return {
    schemaVersion,
    nodes: [
      {
        id: "start",
        type: "trigger.manual",
        version: delay ? 1 : nodeVersion,
        name: "Start",
        config: {},
      },
      ...(delay
        ? [
            {
              id: "wait",
              type: "delay",
              version: nodeVersion,
              name: "Wait",
              config: { minutes: { kind: "value", value: 1 } },
            },
          ]
        : []),
    ],
    edges: delay ? [{ from: "start", to: "wait", port: "next" }] : [],
  };
}

async function seedStoredVersion(h: TestDb, raw: unknown, signal: AbortSignal) {
  const user = await seedUser(h.db, { isAdmin: true });
  const actor = await hydrateActor(h.db, user.id, signal);
  assert(actor !== null, "Missing active fixture actor");
  const pipeline = await seedPipelineWithStages(h.db, ["Proposal"]);
  const stage = pipeline.stages.at(0);
  assert(stage !== undefined, "Missing fixture stage");
  const [deal] = await h.db
    .insert(deals)
    .values({
      title: "Version fence fixture",
      ownerId: user.id,
      pipelineId: pipeline.pipeline.id,
      stageId: stage.id,
      visibilityLevel: "owner",
    })
    .returning();
  signal.throwIfAborted();
  assert(deal !== undefined, "Missing fixture deal");
  const created = await createWorkflow(
    h.db,
    actor,
    {
      name: "Stored-version readiness fixture",
      definition: initialBlankDefinition("Manual start"),
    },
    signal,
  );
  assert(created.ok, JSON.stringify(created));
  const versionId = randomUUID();
  // Model an unsupported stored JSON row at the real persistence boundary.
  // Public publication validates version 1; this fixture does not prove a public bypass.
  await h.pool.query(
    `INSERT INTO workflow_versions(id,workflow_id,number,name,definition,published_by)
     VALUES($1,$2,1,'Stored version fixture',$3::jsonb,$4)`,
    [versionId, created.value.id, JSON.stringify(raw), user.id],
  );
  signal.throwIfAborted();
  const [workflow] = await h.db
    .update(workflows)
    .set({ publishedNumber: 1, active: true })
    .where(eq(workflows.id, created.value.id))
    .returning();
  assert(workflow !== undefined, "Missing published fixture pointer");
  // The ORM JSON type is not runtime validation. Read the raw stored versions through it.
  const [version] = await h.db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, versionId));
  signal.throwIfAborted();
  assert(version !== undefined, "Missing stored fixture version");
  return { ...h, actor, deal, workflow, version };
}

type StoredVersionFixture = Awaited<ReturnType<typeof seedStoredVersion>>;

async function withStoredVersion(
  raw: unknown,
  body: (test: StoredVersionFixture, signal: AbortSignal) => Promise<void>,
) {
  const signal = AbortSignal.timeout(20_000);
  const h = await makeTestDb();
  try {
    const test = await seedStoredVersion(h, raw, signal);
    await body(test, signal);
  } finally {
    await h.close();
  }
}

it.each([
  {
    label: "manual node version 2",
    schemaVersion: 1,
    nodeVersion: 2,
    delay: false,
    invalidNode: true,
  },
  {
    label: "manual node version string 1",
    schemaVersion: 1,
    nodeVersion: "1",
    delay: false,
    invalidNode: true,
  },
  { label: "schema version 2", schemaVersion: 2, nodeVersion: 1, delay: false, invalidNode: false },
  {
    label: "schema version string 1",
    schemaVersion: "1",
    nodeVersion: 1,
    delay: false,
    invalidNode: false,
  },
  {
    label: "delay node version 2",
    schemaVersion: 1,
    nodeVersion: 2,
    delay: true,
    invalidNode: true,
  },
  {
    label: "delay node version string 1",
    schemaVersion: 1,
    nodeVersion: "1",
    delay: true,
    invalidNode: true,
  },
])(
  "rejects $label from stored JSON before run admission",
  async (input) => {
    await withStoredVersion(
      storedDefinition(input.schemaVersion, input.nodeVersion, input.delay),
      async (test, signal) => {
        const node = test.version.definition.nodes.find(
          (entry) => entry.id === (input.delay ? "wait" : "start"),
        );
        assert(node !== undefined, "Missing version-test node");
        expect(test.version.definition.schemaVersion).toBe(input.schemaVersion);
        expect(node.version).toBe(input.nodeVersion);
        expect(
          await admitManualRun(
            test.db,
            test.actor,
            {
              workflowId: test.workflow.id,
              requestKey: randomUUID(),
              recordId: test.deal.id,
              mode: "simulation",
            },
            signal,
          ),
        ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_NOT_READY });
        expect(await test.db.select().from(workflowRuns)).toHaveLength(0);
        expect(executableDefinition(test.version.definition)).toBe(false);
        expect(executableNode(node)).toBe(!input.invalidNode);
      },
    );
  },
  caseTimeout,
);

it(
  "admits supported numeric version 1 from the same stored-JSON fixture",
  async () => {
    await withStoredVersion(storedDefinition(1, 1, false), async (test, signal) => {
      const node = test.version.definition.nodes.find((entry) => entry.id === "start");
      assert(node !== undefined, "Missing supported fixture node");
      expect(executableNode(node)).toBe(true);
      expect(executableDefinition(test.version.definition)).toBe(true);
      const admitted = await admitManualRun(
        test.db,
        test.actor,
        {
          workflowId: test.workflow.id,
          requestKey: randomUUID(),
          recordId: test.deal.id,
          mode: "simulation",
        },
        signal,
      );
      assert(admitted.ok, JSON.stringify(admitted));
      expect(admitted.value.versionId).toBe(test.version.id);
      expect(await test.db.select().from(workflowRuns)).toHaveLength(1);
    });
  },
  caseTimeout,
);
