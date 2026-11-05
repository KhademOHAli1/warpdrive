import type { MappingFieldKey, MappingValueContract } from "./mappingTypes";
import type { ValueType, WorkflowNode } from "./schemas";

type OutputContracts = Record<string, MappingValueContract>;
const text: MappingValueContract = { kind: "text", nullable: false };
const deal: MappingValueContract = { kind: "entity", entity: "deal", nullable: false };
const contracts: Record<WorkflowNode["type"], OutputContracts> = {
  "trigger.manual": { recordId: deal },
  "trigger.record": { recordId: deal, eventId: text },
  "record.read": {
    id: deal,
    title: text,
    ownerId: { kind: "entity", entity: "user", nullable: false },
    stageId: text,
    status: text,
    value: { kind: "decimal", nullable: true },
    currency: text,
    expectedCloseDate: { kind: "date", nullable: true },
  },
  "record.create": { id: text },
  "record.update": { id: text },
  "record.delete": { deleted: { kind: "boolean", nullable: false } },
  "record.search": {
    firstId: { kind: "text", nullable: true },
    totalCount: { kind: "number", nullable: false },
  },
  "record.pick": { id: text },
  "email.draft": {},
  "calendar.create": { id: { kind: "entity", entity: "activity", nullable: false } },
  "activity.create": { id: { kind: "entity", entity: "activity", nullable: false } },
  condition: { result: { kind: "boolean", nullable: false } },
  ifElse: { matchingBranchId: text },
  filter: { matchesFilter: { kind: "boolean", nullable: false } },
  delay: { resumeAt: { kind: "instant", nullable: false } },
  notification: { id: text },
};

export function mappingOutputContracts(type: WorkflowNode["type"]): OutputContracts {
  return structuredClone(contracts[type]);
}

export function isMappingFieldKey(key: string): key is MappingFieldKey {
  return [
    "recordId",
    "id",
    "title",
    "ownerId",
    "stageId",
    "status",
    "value",
    "currency",
    "result",
    "deleted",
    "firstId",
    "totalCount",
    "matchesFilter",
    "matchingBranchId",
    "resumeAt",
    "expectedCloseDate",
  ].includes(key);
}

export function coarseMappingType(contract: MappingValueContract): ValueType {
  if (
    contract.kind === "number" ||
    contract.kind === "boolean" ||
    contract.kind === "decimal" ||
    contract.kind === "date" ||
    contract.kind === "instant"
  )
    return contract.kind;
  return "string";
}

export function coarseMappingOutputs(type: WorkflowNode["type"]): Record<string, ValueType> {
  return Object.fromEntries(
    Object.entries(contracts[type]).map(([field, contract]) => [
      field,
      coarseMappingType(contract),
    ]),
  );
}
