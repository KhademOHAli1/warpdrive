import type {
  ActionBlockKind,
  BlockFieldDescriptor,
  BlockJson,
  BlockReference,
  WorkflowV2Definition,
  WorkflowV2Node,
} from "@/features/blocks/contracts";
import type { BlockVariableChoice } from "@/features/blocks/ui/BlockVariablePicker";
import { outputPorts } from "@/features/blocks/validation";

export function asObject(value: BlockJson | undefined): Record<string, BlockJson> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
export function asArray(value: BlockJson | undefined): BlockJson[] {
  return Array.isArray(value) ? value : [];
}
export function rawValue(value: BlockJson | undefined): BlockJson {
  const object = asObject(value);
  return object.kind === "literal" ? (object.value ?? null) : (value ?? "");
}
export function textValue(value: BlockJson | undefined): string {
  const raw = rawValue(value);
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
}
export function referenceValue(value: BlockJson | undefined): BlockReference | null {
  const object = asObject(value);
  return object.kind === "reference" &&
    typeof object.nodeId === "string" &&
    Array.isArray(object.path)
    ? {
        kind: "reference",
        nodeId: object.nodeId,
        path: object.path.filter(
          (key): key is string | number => typeof key === "string" || typeof key === "number",
        ),
      }
    : null;
}
export function freshId(prefix = "step") {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
export function emptyCondition(): BlockJson {
  return {
    combinator: "and",
    conditions: [
      {
        left: { kind: "literal", value: "" },
        operator: "eq",
        right: { kind: "literal", value: "" },
      },
    ],
  };
}
export function initialConfig(type: ActionBlockKind): Record<string, BlockJson> {
  switch (type) {
    case "CREATE_RECORD":
      return { objectName: "deal", fields: {} };
    case "UPDATE_RECORD":
      return { objectName: "deal", recordId: { kind: "literal", value: "" }, fields: {} };
    case "DELETE_RECORD":
      return { objectName: "deal", recordId: { kind: "literal", value: "" } };
    case "UPSERT_RECORD":
      return {
        objectName: "person",
        matchField: "primaryEmail",
        matchValue: { kind: "literal", value: "" },
        fields: {},
      };
    case "FIND_RECORDS":
      return { objectName: "deal", filters: [], limit: 20, offset: 0 };
    case "PICK_RECORD":
      return { objectName: "person", recordIds: [], selectionMode: "ROUND_ROBIN" };
    case "FILTER":
      return { condition: emptyCondition() };
    case "IF_ELSE":
      return {
        branches: [{ id: freshId("route"), condition: emptyCondition() }, { id: freshId("else") }],
      };
    case "ITERATOR":
      return { items: [], shouldContinueOnIterationFailure: false };
    case "DELAY":
      return { mode: "duration", seconds: 60 };
    case "WAIT_FOR_EVENT":
      return { eventName: "deal.updated", timeoutSeconds: 86400 };
    case "FORM":
      return {
        fields: [
          { id: freshId("field"), name: "answer", label: "", type: "TEXT", required: false },
        ],
        instructions: "",
      };
    case "NEWSLETTER_CONSENT_STATUS":
    case "NEWSLETTER_INVITE":
      return { personId: "", listId: "", ...(type === "NEWSLETTER_INVITE" ? { linkId: "" } : {}) };
    case "SEND_EMAIL":
    case "DRAFT_EMAIL":
      return { accountId: "", to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [] };
    case "CREATE_CALENDAR_EVENT":
      return {
        title: "",
        startsAt: "",
        endsAt: "",
        allDay: false,
        timeZone: "UTC",
        attendeeEmails: [],
        sendInvitations: false,
        createConference: false,
      };
    case "SEND_CHAT_MESSAGE":
      return { recipientId: "", title: "", message: "", requireApproval: false };
    case "HTTP_REQUEST":
      return {
        method: "GET",
        url: "",
        headers: {},
      };
    case "CODE":
      return {
        sourceCode:
          "export const main = async (inputs) => {\n  return { result: inputs.value };\n};",
        inputs: {},
        outputSchema: { type: "object", properties: {} },
      };
    case "LOGIC_FUNCTION":
      return { functionId: "", inputs: {}, outputSchema: { type: "object", properties: {} } };
    case "AI_AGENT":
      return {
        providerModel: "",
        instructions: "",
        prompt: "",
      };
    case "CLASSIFY":
      return { input: "", questions: [{ key: "answer", type: "boolean", instructions: "" }] };
  }
}
export function portsForNode(node: WorkflowV2Node): string[] {
  return outputPorts(node);
}
export function studioSetupHref(type: ActionBlockKind) {
  if (type === "NEWSLETTER_CONSENT_STATUS" || type === "NEWSLETTER_INVITE") return "/campaigns";
  return type === "SEND_EMAIL" || type === "DRAFT_EMAIL"
    ? "/settings/email-sync"
    : "/settings/workflow-runtime";
}
export function updateStudioNode(
  definition: WorkflowV2Definition,
  node: WorkflowV2Node,
): WorkflowV2Definition {
  const ports = new Set(portsForNode(node));
  return {
    ...definition,
    nodes: definition.nodes.map((current) => (current.id === node.id ? node : current)),
    edges: definition.edges.filter((edge) => edge.source !== node.id || ports.has(edge.sourcePort)),
  };
}
export function replaceStudioNode(
  definition: WorkflowV2Definition,
  id: string,
  type: ActionBlockKind,
  name: string,
): WorkflowV2Definition | null {
  const previous = definition.nodes.find((node) => node.id === id);
  if (previous === undefined) return null;
  if (previous.type === type) return definition;
  const node: WorkflowV2Node = { id, type, version: 1, name, config: initialConfig(type) };
  const from = previous.type === "ITERATOR" ? "done" : "next";
  const to = type === "ITERATOR" ? "done" : "next";
  return {
    ...definition,
    nodes: definition.nodes.map((current) => (current.id === id ? node : current)),
    edges: definition.edges.flatMap((edge) => {
      if (edge.source !== id) return [edge];
      if (previous.type === "IF_ELSE" || type === "IF_ELSE" || edge.sourcePort !== from) return [];
      return [{ ...edge, sourcePort: to }];
    }),
  };
}

export function duplicateStudioNode(
  definition: WorkflowV2Definition,
  id: string,
  copyId: string,
): WorkflowV2Definition | null {
  const source = definition.nodes.find((node) => node.id === id);
  if (
    source === undefined ||
    definition.nodes.length >= 100 ||
    definition.nodes.some((node) => node.id === copyId)
  )
    return null;
  const suffix = " (Duplicate)";
  const layout = definition.layout ?? arrangeStudio(definition).layout;
  const position = layout?.[id] ?? { x: 0, y: 0 };
  return {
    ...definition,
    nodes: [
      ...definition.nodes,
      {
        ...structuredClone(source),
        id: copyId,
        name: source.name.slice(0, 100 - suffix.length).trimEnd() + suffix,
      },
    ],
    layout: { ...layout, [copyId]: { x: position.x + 50, y: position.y + 50 } },
  };
}

export function removeStudioNode(
  definition: WorkflowV2Definition,
  id: string,
): WorkflowV2Definition {
  return {
    ...definition,
    nodes: definition.nodes.filter((node) => node.id !== id),
    edges: definition.edges.filter((edge) => edge.source !== id && edge.target !== id),
    entryNodeIds: definition.entryNodeIds.filter((entry) => entry !== id),
  };
}
export function connectStudioNodes(
  definition: WorkflowV2Definition,
  source: string,
  target: string,
  sourcePort: string,
): WorkflowV2Definition | null {
  if (source === target || target === "$trigger") return null;
  if (source === "$trigger")
    return {
      ...definition,
      entryNodeIds: [...new Set([...definition.entryNodeIds, target])],
      edges: definition.edges.filter((edge) => edge.target !== target),
    };
  const node = definition.nodes.find((item) => item.id === source);
  if (node === undefined || !portsForNode(node).includes(sourcePort)) return null;
  const pending = [target];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === source) return null;
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    pending.push(
      ...definition.edges.filter((edge) => edge.source === id).map((edge) => edge.target),
    );
  }
  return {
    ...definition,
    entryNodeIds: definition.entryNodeIds.filter((id) => id !== target),
    edges: [
      ...definition.edges.filter((edge) => edge.target !== target),
      { id: freshId("edge"), source, target, sourcePort },
    ],
  };
}
export function insertStudioNodeOnEdge(
  definition: WorkflowV2Definition,
  node: WorkflowV2Node,
  edgeId: string,
): WorkflowV2Definition | null {
  if (definition.nodes.some((current) => current.id === node.id)) return null;
  const entry = definition.entryNodeIds.find((id) => `$trigger:${id}` === edgeId);
  const edge = definition.edges.find((current) => current.id === edgeId);
  if (entry === undefined && edge === undefined) return null;
  const exit = portsForNode(node).find((port) => port === "done") ?? portsForNode(node)[0];
  if (exit === undefined) return null;
  const target = entry ?? edge?.target;
  if (target === undefined || !definition.nodes.some((current) => current.id === target))
    return null;
  const draft = {
    ...definition,
    nodes: [...definition.nodes, node],
    entryNodeIds:
      entry === undefined
        ? definition.entryNodeIds
        : definition.entryNodeIds.map((id) => (id === entry ? node.id : id)),
    edges: definition.edges.map((current) =>
      current.id === edgeId ? { ...current, target: node.id } : current,
    ),
  };
  return connectStudioNodes(draft, node.id, target, exit);
}

export function arrangeStudio(definition: WorkflowV2Definition): WorkflowV2Definition {
  const layout: NonNullable<WorkflowV2Definition["layout"]> = { $trigger: { x: 0, y: 0 } };
  const rows = new Map<number, number>();
  function place(id: string, depth: number) {
    if (layout[id] !== undefined) return;
    const column = rows.get(depth) ?? 0;
    rows.set(depth, column + 1);
    layout[id] = { x: column * 285, y: depth * 150 };
    for (const edge of definition.edges) if (edge.source === id) place(edge.target, depth + 1);
  }
  for (const id of definition.entryNodeIds) place(id, 1);
  for (const node of definition.nodes) place(node.id, 1);
  return { ...definition, layout };
}
type VariableLabels = { wholeRecord: string; wholeList: string; output: string };
type VariableFieldCatalog = Readonly<Record<string, readonly BlockFieldDescriptor[]>>;
type AddVariable = (path: (string | number)[], label: string, type: string) => void;
function ancestorPorts(definition: WorkflowV2Definition, selected: string) {
  const ports = new Map<string, string>();
  let cursor = selected;
  for (let index = 0; index < definition.nodes.length; index++) {
    const edge = definition.edges.find((item) => item.target === cursor);
    if (edge === undefined || ports.has(edge.source)) break;
    ports.set(edge.source, edge.sourcePort);
    cursor = edge.source;
  }
  return ports;
}
function recordOutputs(
  add: AddVariable,
  prefix: string,
  fields: readonly BlockFieldDescriptor[],
  label: string,
) {
  add([prefix], label, "record");
  for (const field of fields) {
    if (!field.readable) continue;
    const type =
      field.format === "date" ? "date" : field.format === "datetime" ? "instant" : field.type;
    add([prefix, ...field.key.split(".")], field.label, type);
  }
}
function triggerOutputs(
  definition: WorkflowV2Definition,
  fields: VariableFieldCatalog,
  labels: VariableLabels,
  add: AddVariable,
) {
  const trigger = definition.trigger;
  const config = trigger.config;
  if (
    trigger.type === "newsletter.identity.verified" ||
    trigger.type === "newsletter.consent.confirmed"
  ) {
    add(["personId"], labels.output, "string");
    add(["linkId"], labels.output, "string");
    if (trigger.type === "newsletter.consent.confirmed") add(["listId"], labels.output, "number");
    add(["occurredAt"], labels.output, "instant");
    return;
  }
  const entityFields = fields[textValue(config.objectName)] ?? [];
  if (trigger.type === "manual" && config.availability === "bulk") {
    add(["recordIds"], "IDs", "array");
    add(["records"], labels.wholeList, "array");
    return;
  }
  if (
    trigger.type.startsWith("record.") ||
    (trigger.type === "manual" && config.availability === "single")
  ) {
    add(["recordId"], "ID", "string");
    recordOutputs(add, "record", entityFields, labels.wholeRecord);
  }
  if (trigger.type === "record.updated" || trigger.type === "record.created_or_updated") {
    add(["changedFields"], labels.wholeList, "array");
    recordOutputs(add, "previousRecord", entityFields, labels.wholeRecord);
  }
}
const knownOutputs: Partial<Record<ActionBlockKind, readonly [string, string][]>> = {
  FILTER: [["matchesFilter", "boolean"]],
  IF_ELSE: [["matchingBranchId", "string"]],
  DELAY: [["resumedAt", "instant"]],
  WAIT_FOR_EVENT: [["hasTimedOut", "boolean"]],
  SEND_CHAT_MESSAGE: [["approved", "boolean"]],
  NEWSLETTER_CONSENT_STATUS: [
    ["state", "string"],
    ["confirmed", "boolean"],
    ["linkId", "string"],
  ],
  NEWSLETTER_INVITE: [
    ["state", "string"],
    ["id", "string"],
  ],
  SEND_EMAIL: [
    ["status", "string"],
    ["messageId", "string"],
  ],
  HTTP_REQUEST: [
    ["status", "number"],
    ["headers", "object"],
    ["body", "any"],
  ],
};
function iteratorOutputs(
  definition: WorkflowV2Definition,
  node: WorkflowV2Node,
  port: string,
  fields: VariableFieldCatalog,
  labels: VariableLabels,
  add: AddVariable,
) {
  add(["hasProcessedAllItems"], labels.output, "boolean");
  if (port !== "loop") return;
  add(["currentItemIndex"], labels.output, "number");
  const ref = referenceValue(node.config.items);
  const source = definition.nodes.find((item) => item.id === ref?.nodeId);
  if (source?.type === "FIND_RECORDS" && ref?.path[0] === "records") {
    recordOutputs(
      add,
      "currentItem",
      fields[textValue(source.config.objectName)] ?? [],
      labels.wholeRecord,
    );
  } else add(["currentItem"], labels.wholeRecord, "any");
}
const formOutputTypes: Readonly<Record<string, string>> = {
  TEXT: "string",
  NUMBER: "number",
  DATE: "date",
  SELECT: "string",
  MULTI_SELECT: "array",
  RECORD: "string",
};
function formOutputs(node: WorkflowV2Node, add: AddVariable) {
  for (const field of asArray(node.config.fields).map(asObject)) {
    const key = textValue(field.name);
    if (key !== "")
      add(
        ["response", key],
        textValue(field.label) || key,
        formOutputTypes[textValue(field.type)] ?? "any",
      );
  }
}
function classificationOutputs(node: WorkflowV2Node, add: AddVariable) {
  for (const question of asArray(node.config.questions).map(asObject)) {
    const key = textValue(question.key);
    if (key !== "")
      add(
        [key],
        key,
        question.type === "score" ? "number" : question.type === "boolean" ? "boolean" : "string",
      );
  }
}
function configuredOutputs(node: WorkflowV2Node, add: AddVariable) {
  if (node.type === "FORM") formOutputs(node, add);
  if (node.type === "CLASSIFY") classificationOutputs(node, add);
  const schema = asObject(node.config.outputSchema ?? node.config.responseSchema);
  const prefix = node.type === "HTTP_REQUEST" ? ["body"] : [];
  for (const [key, descriptor] of Object.entries(asObject(schema.properties))) {
    add([...prefix, key], key, textValue(asObject(descriptor).type) || "any");
  }
}
function nodeVariables(
  definition: WorkflowV2Definition,
  node: WorkflowV2Node,
  port: string,
  fields: VariableFieldCatalog,
  labels: VariableLabels,
  add: AddVariable,
) {
  if (
    ["CREATE_RECORD", "UPDATE_RECORD", "DELETE_RECORD", "UPSERT_RECORD", "PICK_RECORD"].includes(
      node.type,
    )
  ) {
    add(["recordId"], "ID", "string");
    recordOutputs(
      add,
      "record",
      fields[textValue(node.config.objectName)] ?? [],
      labels.wholeRecord,
    );
  }
  if (node.type === "FIND_RECORDS") {
    add(["records"], labels.wholeList, "array");
    add(["count"], labels.output, "number");
  }
  if (node.type === "ITERATOR") iteratorOutputs(definition, node, port, fields, labels, add);
  for (const [key, type] of knownOutputs[node.type] ?? []) add([key], key, type);
  configuredOutputs(node, add);
}
export function studioVariables(
  definition: WorkflowV2Definition,
  selected: string,
  fields: VariableFieldCatalog,
  labels: VariableLabels,
): { choices: BlockVariableChoice[]; references: Map<string, BlockReference> } {
  const ports = ancestorPorts(definition, selected);
  const choices: BlockVariableChoice[] = [];
  const references = new Map<string, BlockReference>();
  function forNode(nodeId: string, group: string): AddVariable {
    return (path, label, type) => {
      const id = `${nodeId}:${path.join(".")}`;
      choices.push({ id, group, label, path: path.join("."), type });
      references.set(id, { kind: "reference", nodeId, path });
    };
  }
  const addTrigger = forNode("$trigger", labels.output);
  addTrigger([], labels.wholeRecord, "object");
  triggerOutputs(definition, fields, labels, addTrigger);
  for (const node of definition.nodes) {
    const port = ports.get(node.id);
    if (port === undefined) continue;
    const add = forNode(node.id, node.name);
    add([], labels.wholeRecord, "object");
    nodeVariables(definition, node, port, fields, labels, add);
  }
  return { choices, references };
}
