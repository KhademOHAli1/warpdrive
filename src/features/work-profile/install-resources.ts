import type { Db } from "@/db/client";
import { activityTypes, customFieldDefs, pipelines, stages } from "@/db/schema";
import type { Preset, Preview } from "./contracts";
import { fail } from "./errors";
import type { NativeState } from "./install-state";
import { type ResourceSnapshot, workStages, workTypes } from "./schema";

type Operation = Preview["operations"][number];

async function createPipeline(
  db: Db,
  name: string,
  preset: Preset,
  state: NativeState,
  signal: AbortSignal,
) {
  const [row] = await db
    .insert(pipelines)
    .values({
      name,
      order: Math.max(-1, ...state.pipelines.map((value) => value.order)) + 1,
    })
    .returning();
  signal.throwIfAborted();
  if (!row) fail("unavailable");
  await db
    .insert(stages)
    .values(preset.sales.stages.map((name, order) => ({ name, order, pipelineId: row.id })));
  signal.throwIfAborted();
  return row.id;
}

async function createWorkType(db: Db, operation: Operation, preset: Preset, signal: AbortSignal) {
  const [row] = await db
    .insert(workTypes)
    .values({
      key: operation.key,
      name: operation.name,
      kind: preset.id,
      fields: preset.delivery.fields,
    })
    .returning();
  signal.throwIfAborted();
  if (!row) fail("unavailable");
  await db
    .insert(workStages)
    .values(preset.delivery.stages.map((stage, order) => ({ ...stage, order, typeId: row.id })));
  signal.throwIfAborted();
  return row.id;
}

async function createDealField(
  db: Db,
  key: string,
  preset: Preset,
  state: NativeState,
  signal: AbortSignal,
) {
  const field = preset.dealFields.find((value) => value.key === key);
  if (!field) fail("invalid_input");
  const [row] = await db
    .insert(customFieldDefs)
    .values({
      ...field,
      targetEntity: "deal",
      isRequired: false,
      isImportant: false,
      showInAddForm: true,
      order:
        Math.max(
          -1,
          ...state.fields
            .filter((value) => value.targetEntity === "deal")
            .map((value) => value.order),
        ) + 1,
    })
    .returning();
  signal.throwIfAborted();
  return row?.id;
}

async function createActivityType(
  db: Db,
  key: string,
  preset: Preset,
  state: NativeState,
  signal: AbortSignal,
) {
  const activity = preset.activityTypes.find((value) => value.key === key);
  if (!activity) fail("invalid_input");
  const [row] = await db
    .insert(activityTypes)
    .values({
      ...activity,
      isSystem: false,
      order: Math.max(-1, ...state.activities.map((value) => value.order)) + 1,
    })
    .returning();
  signal.throwIfAborted();
  return row?.id;
}

function reuseResource(operation: Operation, state: NativeState) {
  switch (operation.kind) {
    case "pipeline":
      return state.pipelines.find(
        (value) => value.name.toLocaleLowerCase() === operation.name.toLocaleLowerCase(),
      )?.id;
    case "work_type":
      return state.types.find((value) => value.key === operation.key)?.id;
    case "deal_field":
      return state.fields.find(
        (value) => value.targetEntity === "deal" && value.key === operation.key,
      )?.id;
    case "activity_type":
      return state.activities.find((value) => value.key === operation.key)?.id;
  }
}

function createResource(
  db: Db,
  operation: Operation,
  preset: Preset,
  state: NativeState,
  signal: AbortSignal,
) {
  switch (operation.kind) {
    case "pipeline":
      return createPipeline(db, operation.name, preset, state, signal);
    case "work_type":
      return createWorkType(db, operation, preset, signal);
    case "deal_field":
      return createDealField(db, operation.key, preset, state, signal);
    case "activity_type":
      return createActivityType(db, operation.key, preset, state, signal);
  }
}

export async function installResource(
  db: Db,
  operation: Operation,
  preset: Preset,
  state: NativeState,
  signal: AbortSignal,
): Promise<Omit<ResourceSnapshot, "snapshot">> {
  const created = operation.disposition === "create";
  const id = created
    ? await createResource(db, operation, preset, state, signal)
    : reuseResource(operation, state);
  if (id === undefined || id === "") fail("unavailable");
  return { kind: operation.kind, id, key: operation.key, created };
}
