import type { CustomFieldDef } from "@/types/customFields";
import { configurationLimits } from "./configurationLimits";
import type {
  ConfigurationFieldSpec,
  ConfigurationMetadata,
  ConfigurationProfile,
  ConfigurationSpec,
  ConfigurationValueKind,
} from "./configurationTypes";
import { delayDurationUnits } from "./delayConfig";
import { newIfElseConfig } from "./ifElseConfig";
import type { ValueType, WorkflowNode } from "./schemas";

export { configurationLimits } from "./configurationLimits";

function field(
  key: string,
  label: string,
  valueType: ConfigurationValueKind,
  options: Partial<ConfigurationFieldSpec> = {},
): ConfigurationFieldSpec {
  return {
    path: [key],
    label,
    labelSource: "translation",
    control: "binding",
    valueType,
    required: true,
    nullable: false,
    modes: ["literal", "reference"],
    ...options,
  };
}

const name = field("name", "stepName", "node-name", {
  control: "name",
  modes: ["literal"],
  constraints: {
    minLength: configurationLimits.nameMin,
    maxLength: configurationLimits.nameMax,
    trim: true,
  },
});
const subject = field("subject", "subjectLabel", "string", {
  constraints: {
    minLength: configurationLimits.subjectMin,
    maxLength: configurationLimits.subjectMax,
    trim: true,
  },
});
const unavailable = (key: string, type: ConfigurationValueKind) =>
  field(key, key, type, { required: false, readOnly: true });

export const configurationProfiles: Record<WorkflowNode["type"], ConfigurationProfile> = {
  "trigger.manual": { supported: true, fields: [name] },
  "trigger.record": {
    supported: false,
    fields: [name, unavailable("entity", "entity"), unavailable("event", "string")],
  },
  "record.read": {
    supported: true,
    fields: [
      name,
      field("entity", "entity", "entity", {
        control: "entity",
        modes: ["literal"],
        choices: ["deal"],
      }),
      field("recordId", "recordIdLabel", "deal"),
    ],
  },
  "activity.create": {
    supported: true,
    fields: [
      name,
      subject,
      field("dealId", "linkedDeal", "deal", {
        required: false,
        nullable: true,
        modes: ["literal", "reference", "null", "omit"],
      }),
      unavailable("assigneeId", "string"),
      unavailable("dueAt", "string"),
      unavailable("typeId", "string"),
    ],
  },
  condition: {
    supported: true,
    fields: [
      name,
      field("left", "conditionField", "scalar", { modes: ["reference"], nullable: true }),
      field("operator", "conditionOperator", "operator", {
        control: "operator",
        modes: ["literal"],
        choices: ["exists", "equals", "notEquals", "contains"],
      }),
      field("right", "conditionValue", "scalar", {
        nullable: true,
        modes: ["literal", "reference", "null"],
        requiredWhen: { field: "operator", not: "exists" },
      }),
    ],
  },
  ifElse: { supported: true, fields: [name] },
  "record.create": { supported: true, fields: [name] },
  "record.update": { supported: true, fields: [name] },
  "record.delete": { supported: true, fields: [name] },
  "record.search": { supported: true, fields: [name] },
  "record.pick": { supported: true, fields: [name] },
  "email.draft": { supported: true, fields: [name] },
  filter: {
    supported: true,
    fields: [
      name,
      field("left", "conditionField", "scalar", { modes: ["reference"], nullable: true }),
      field("operator", "conditionOperator", "operator", {
        control: "operator",
        modes: ["literal"],
        choices: ["exists", "equals", "notEquals", "contains"],
      }),
      field("right", "conditionValue", "scalar", {
        nullable: true,
        modes: ["literal", "reference", "null"],
        requiredWhen: { field: "operator", not: "exists" },
      }),
    ],
  },
  delay: {
    supported: true,
    fields: [
      name,
      field("minutes", "delayMinutesLabel", "numeric", {
        control: "duration",
        modes: ["literal"],
        constraints: {
          min: configurationLimits.waitMin,
          max: configurationLimits.waitMax,
          integer: true,
        },
      }),
      field("until", "delayUntilLabel", "scalar", {
        required: false,
        modes: ["literal"],
      }),
      ...delayDurationUnits.map((unit) =>
        field(unit, `delayUnits.${unit}`, "numeric", {
          path: ["duration", unit],
          required: false,
          constraints: { min: 0 },
        }),
      ),
      field("scheduledDateTime", "delayScheduledDateTime", "scalar"),
    ],
  },
  notification: { supported: false, fields: [name, unavailable("title", "string")] },
};

const referenceTypes = new Set<CustomFieldDef["type"]>([
  "text",
  "large_text",
  "autocomplete",
  "phone",
  "date",
  "time",
  "numeric",
  "monetary",
]);

function customSpec(def: CustomFieldDef): ConfigurationFieldSpec {
  const modes: ConfigurationFieldSpec["modes"] = ["literal"];
  if (referenceTypes.has(def.type)) modes.push("reference");
  if (!def.isRequired) modes.push("omit");
  return {
    path: ["customFields", def.id],
    label: def.name,
    labelSource: "metadata",
    control: "custom",
    valueType: def.type,
    required: def.isRequired,
    nullable: false,
    modes,
    customField: structuredClone(def),
  };
}

function knownType(type: unknown): type is WorkflowNode["type"] {
  return typeof type === "string" && Object.hasOwn(configurationProfiles, type);
}

export function getConfigurationSpec(
  type: unknown,
  version: unknown,
  metadata?: ConfigurationMetadata,
): ConfigurationSpec | null {
  if (!knownType(type) || version !== 1) return null;
  const profile = structuredClone(configurationProfiles[type]);
  if (type === "activity.create") {
    const defs = metadata?.status === "denied" ? [] : (metadata?.defs ?? []);
    const custom = defs
      .filter((def) => def.targetEntity === "activity" && def.archivedAt === null)
      .map(customSpec);
    profile.fields.push(...custom);
  }
  return { type, version: 1, ...profile };
}

export function conditionSourceDefaults(source: {
  type?: ValueType;
  field?: string;
}): WorkflowNode["config"] {
  if (source.type === "number")
    return { operator: "equals", right: { kind: "value", value: "", literalType: "number" } };
  if (source.type === "date" || source.type === "instant")
    return { operator: "equals", right: { kind: "value", value: "", literalType: source.type } };
  const value = source.type === "boolean" ? true : source.field === "status" ? "open" : "";
  return { operator: "equals", right: { kind: "value", value } };
}

export function defaultConfiguration(
  type: WorkflowNode["type"],
  source: { trigger?: WorkflowNode; read?: WorkflowNode; subject?: string },
): WorkflowNode["config"] {
  const recordId = { kind: "reference", nodeId: source.trigger?.id ?? "start", path: ["recordId"] };
  if (type === "record.read") return { entity: "deal", recordId };
  if (type === "ifElse") return newIfElseConfig();
  if (type === "record.create" || type === "record.update") return { fields: {} };
  if (type === "record.delete" || type === "record.search" || type === "email.draft") return {};
  if (type === "record.pick") return { strategy: "RANDOM", recordIds: [] };
  if (type === "activity.create")
    return { subject: { kind: "value", value: source.subject ?? "" }, dealId: recordId };
  if (type === "delay")
    return {
      delayType: "DURATION",
      duration: { minutes: { kind: "value", value: configurationLimits.waitMin } },
    };
  if (type !== "condition" && type !== "filter") return {};
  const read = source.read;
  return {
    left: {
      kind: "reference",
      nodeId: read?.id ?? source.trigger?.id ?? "start",
      path: [read === undefined ? "recordId" : "status"],
    },
    ...(read === undefined
      ? { operator: "exists" }
      : conditionSourceDefaults({ type: "string", field: "status" })),
  };
}
