import {
  ACTION_BLOCK_KINDS,
  type ActionBlockKind,
  TRIGGER_BLOCK_KINDS,
  type TriggerBlockKind,
} from "./contracts";
export type BlockEffect = "pure" | "read" | "database" | "external" | "wait";
export interface SharedBlockDescriptor {
  id: ActionBlockKind | TriggerBlockKind;
  version: 1;
  category: "data" | "logic" | "flow" | "communication" | "integration" | "trigger";
  effect: BlockEffect;
  kpiAllowed: boolean;
  workflowAllowed: boolean;
}
const effects: Record<ActionBlockKind, BlockEffect> = {
  CODE: "external",
  LOGIC_FUNCTION: "external",
  SEND_EMAIL: "external",
  NEWSLETTER_CONSENT_STATUS: "external",
  NEWSLETTER_INVITE: "external",
  SEND_CHAT_MESSAGE: "database",
  DRAFT_EMAIL: "database",
  CREATE_CALENDAR_EVENT: "database",
  CREATE_RECORD: "database",
  UPDATE_RECORD: "database",
  DELETE_RECORD: "database",
  UPSERT_RECORD: "database",
  FIND_RECORDS: "read",
  PICK_RECORD: "database",
  FORM: "wait",
  FILTER: "pure",
  IF_ELSE: "pure",
  HTTP_REQUEST: "external",
  AI_AGENT: "external",
  CLASSIFY: "external",
  ITERATOR: "pure",
  DELAY: "wait",
  WAIT_FOR_EVENT: "wait",
};
function category(kind: ActionBlockKind): SharedBlockDescriptor["category"] {
  if (
    [
      "CREATE_RECORD",
      "UPDATE_RECORD",
      "DELETE_RECORD",
      "UPSERT_RECORD",
      "FIND_RECORDS",
      "PICK_RECORD",
    ].includes(kind)
  )
    return "data";
  if (
    [
      "SEND_EMAIL",
      "SEND_CHAT_MESSAGE",
      "DRAFT_EMAIL",
      "CREATE_CALENDAR_EVENT",
      "NEWSLETTER_CONSENT_STATUS",
      "NEWSLETTER_INVITE",
    ].includes(kind)
  )
    return "communication";
  if (["FILTER", "IF_ELSE", "CODE", "LOGIC_FUNCTION"].includes(kind)) return "logic";
  if (["FORM", "ITERATOR", "DELAY", "WAIT_FOR_EVENT"].includes(kind)) return "flow";
  return "integration";
}
export const sharedBlockCatalog: SharedBlockDescriptor[] = [
  ...ACTION_BLOCK_KINDS.map((id) => ({
    id,
    version: 1 as const,
    category: category(id),
    effect: effects[id],
    kpiAllowed: ["FIND_RECORDS", "FILTER", "IF_ELSE"].includes(id),
    workflowAllowed: true,
  })),
  ...TRIGGER_BLOCK_KINDS.map((id) => ({
    id,
    version: 1 as const,
    category: "trigger" as const,
    effect: "pure" as const,
    kpiAllowed: false,
    workflowAllowed: true,
  })),
];
export const sharedKpiComputeProfiles = [
  "metric",
  "constant",
  "compute",
  "compare",
  "logic",
  "branch",
  "output",
] as const;
export function findSharedBlock(id: string): SharedBlockDescriptor | undefined {
  return sharedBlockCatalog.find((block) => block.id === id);
}
