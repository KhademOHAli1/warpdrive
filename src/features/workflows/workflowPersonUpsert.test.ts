import { TransactionRollbackError } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type * as ContactActorAdapters from "@/features/contacts/actorAdapters";
import type * as PersonsRepo from "@/features/contacts/personsRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import type { WorkflowDefinition } from "./schemas";
import { upsertWorkflowPerson, type WorkflowPersonUpsertScope } from "./workflowPersonUpsert";
import { workflowPersonUpsertConfig } from "./workflowPersonUpsertContract";

const native = vi.hoisted(() => ({
  createPersonAtId: vi.fn(),
  loadContactActor: vi.fn(),
  hydrateActor: vi.fn(),
  assertReferenceVisible: vi.fn(),
  mutateNativeRecord: vi.fn(),
  resolveRunBinding: vi.fn(),
}));
vi.mock("@/features/contacts/personsRepo", async (original) => ({
  ...(await original<typeof PersonsRepo>()),
  createPersonAtId: native.createPersonAtId,
}));
vi.mock("@/features/contacts/actorAdapters", async (original) => ({
  ...(await original<typeof ContactActorAdapters>()),
  loadContactActor: native.loadContactActor,
}));
vi.mock("@/server/hydrateActor", () => ({ hydrateActor: native.hydrateActor }));
vi.mock("@/features/permissions/referenceCheck", () => ({
  assertReferenceVisible: native.assertReferenceVisible,
}));
vi.mock("./workflowRecordMutationNative", () => ({
  mutateNativeRecord: native.mutateNativeRecord,
}));
vi.mock("./runBindings", () => ({ resolveRunBinding: native.resolveRunBinding }));

const actor: PermSetUser = {
  id: "52f6b244-2ea8-400a-92c9-b584c938562f",
  isActive: true,
  type: "regular",
  flags: new Set(["contact.create"]),
  groupIds: new Set(),
  managedUserIds: new Set(["managed-owner"]),
};
const scope = { workflowId: "81f1444b-8d8f-4ce1-a769-6c8bf3a030f3", mode: "live" } as const;
const organization = "abf7229b-c3be-4834-9cf9-2f7036b68b46";
const literal = (value: string | null) => ({ kind: "value" as const, value });
const settings = {
  entity: "person",
  key: literal("Source:123"),
  fields: { name: literal("Ada Lovelace") },
};
const definition: WorkflowDefinition = { schemaVersion: 1, nodes: [], edges: [] };
const signal = new AbortController().signal;

function fixture() {
  const rollback = vi.fn(() => {
    throw new TransactionRollbackError();
  });
  const savepoint = { rollback } as unknown as Db;
  const transaction = vi.fn(async (work: (tx: Db) => Promise<unknown>) => work(savepoint));
  return { db: { rollback: vi.fn(), transaction } as unknown as Db, savepoint, rollback };
}

function run(
  tx: Db,
  config: unknown = settings,
  context: WorkflowPersonUpsertScope = scope,
  id = "upsert",
) {
  return upsertWorkflowPerson(
    tx,
    actor,
    { id, version: 1, config },
    {},
    definition,
    context,
    signal,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  native.hydrateActor.mockResolvedValue(actor);
  native.loadContactActor.mockResolvedValue({ ...actor, primaryVisibilityGroupId: "group" });
  native.assertReferenceVisible.mockResolvedValue(
    err(new AppError(ERROR_IDS.CONTACT_NOT_FOUND, "not found")),
  );
  native.createPersonAtId.mockImplementation((_tx, _actor, _input, id: string) =>
    Promise.resolve(ok({ id })),
  );
  native.mutateNativeRecord.mockImplementation((_tx, _entity, { id }: { id: string }) =>
    Promise.resolve(ok({ id })),
  );
});

it("restricts settings to the stable key and common Person fields", () => {
  expect(workflowPersonUpsertConfig.safeParse(settings).success).toBe(true);
  for (const config of [
    { ...settings, entity: "organization" },
    { ...settings, recordId: organization },
    { ...settings, key: literal("a".repeat(129)) },
    { ...settings, key: literal(" ") },
    { ...settings, fields: { ...settings.fields, email: literal("sam@example.test") } },
    { ...settings, fields: { ...settings.fields, ownerId: literal(organization) } },
    { ...settings, fields: { ...settings.fields, firstName: literal(null) } },
  ])
    expect(workflowPersonUpsertConfig.safeParse(config).success).toBe(false);
  expect(
    workflowPersonUpsertConfig.safeParse({
      ...settings,
      fields: { ...settings.fields, orgId: literal(null) },
    }).success,
  ).toBe(true);
});

it("scopes the exact native ID to the workflow and canonical key, never an entered UUID", async () => {
  const { db, savepoint } = fixture();
  const config = { ...settings, key: literal(organization) };
  const first = await run(db, config);
  expect(
    first.ok &&
      z.uuid({ version: "v8" }).safeParse(first.value.id).success &&
      first.value.id !== organization,
  ).toBe(true);
  expect(
    await run(db, { ...config, key: literal(` ${organization} `) }, scope, "another-node"),
  ).toEqual(first);
  expect(await run(db, config, { ...scope, workflowId: actor.id })).not.toEqual(first);
  expect(await run(db, { ...config, key: literal(organization.toUpperCase()) })).not.toEqual(first);
  expect(native.createPersonAtId).toHaveBeenNthCalledWith(
    1,
    savepoint,
    expect.objectContaining({ id: actor.id, managedUserIds: actor.managedUserIds }),
    expect.objectContaining({ name: "Ada Lovelace" }),
    first.ok ? first.value.id : undefined,
    signal,
  );
});

it("uses the same normalized name and link patch for both native branches", async () => {
  const { db, savepoint } = fixture();
  const config = {
    ...settings,
    fields: {
      name: literal("Ada Lovelace"),
      firstName: literal("Marie"),
      lastName: literal("Curie"),
      orgId: literal(null),
    },
  };
  const created = await run(db, config);
  const id = created.ok ? created.value.id : undefined;
  const fields = { name: "Marie Curie", firstName: "Marie", lastName: "Curie", orgId: null };
  expect(native.createPersonAtId).toHaveBeenCalledWith(
    savepoint,
    expect.any(Object),
    expect.objectContaining(fields),
    id,
    signal,
  );
  native.assertReferenceVisible.mockResolvedValue(ok(undefined));
  native.hydrateActor.mockResolvedValue({ ...actor, flags: new Set() });
  expect(await run(db, config)).toEqual(created);
  expect(native.mutateNativeRecord).toHaveBeenCalledWith(
    savepoint,
    "person",
    expect.objectContaining({ id, patch: fields }),
  );
  expect(native.createPersonAtId).toHaveBeenCalledOnce();
});

it("lets the native locked update decide a collision and never creates a replacement", async () => {
  const { db, rollback } = fixture();
  native.createPersonAtId.mockResolvedValue(ok(null));
  expect(await run(db)).toEqual(ok({ id: expect.any(String) }));
  native.mutateNativeRecord.mockResolvedValue(err(ERROR_IDS.CONTACT_NOT_FOUND));
  expect(await run(db)).toEqual(err(ERROR_IDS.CONTACT_NOT_FOUND));
  expect(native.createPersonAtId).toHaveBeenCalledTimes(2);
  expect(native.mutateNativeRecord).toHaveBeenCalledTimes(2);
  expect(rollback).toHaveBeenCalledOnce();
});

it("does not create when native edit loses access or when current create permission is denied", async () => {
  const { db } = fixture();
  native.assertReferenceVisible.mockResolvedValueOnce(ok(undefined));
  native.mutateNativeRecord.mockResolvedValueOnce(err(ERROR_IDS.CONTACT_NOT_FOUND));
  expect(await run(db)).toEqual(err(ERROR_IDS.CONTACT_NOT_FOUND));
  native.hydrateActor.mockResolvedValueOnce({ ...actor, flags: new Set() });
  expect(await run(db)).toEqual(err(ERROR_IDS.PERM_DENIED));
  expect(native.createPersonAtId).not.toHaveBeenCalled();
});

it("fails closed for an invalid mapped key and rolls a valid published preview back", async () => {
  const { db, rollback } = fixture();
  const key = { kind: "reference", nodeId: "read", path: ["title"] };
  native.resolveRunBinding.mockReturnValueOnce({ state: "value", value: 123 });
  expect(await run(db, { ...settings, key })).toEqual(err(ERROR_IDS.WORKFLOW_INVALID));
  expect(native.resolveRunBinding).toHaveBeenCalledWith(
    key,
    {},
    { definition, nodeId: "upsert", path: ["key"] },
  );
  expect(native.createPersonAtId).not.toHaveBeenCalled();
  expect(await run(db, settings, { ...scope, mode: "simulation" })).toEqual(
    ok({ id: expect.any(String) }),
  );
  expect(rollback).toHaveBeenCalledOnce();
});
