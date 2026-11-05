import type { ConfigurationIssue } from "./configurationTypes";

export type MappingValueKind =
  | "text"
  | "number"
  | "boolean"
  | "decimal"
  | "date"
  | "instant"
  | "time"
  | "date-range"
  | "time-range"
  | "address"
  | "entity"
  | "option"
  | "options"
  | "scalar";

export interface MappingValueContract {
  kind: MappingValueKind;
  nullable: boolean;
  entity?: "deal" | "lead" | "activity" | "user" | "person" | "organization";
  optionFieldId?: string;
}

export type MappingFieldKey =
  | "recordId"
  | "id"
  | "title"
  | "ownerId"
  | "stageId"
  | "status"
  | "value"
  | "currency"
  | "result"
  | "formAnswer"
  | "currentItem"
  | "currentItemIndex"
  | "processedCount"
  | "failedCount"
  | "hasProcessedAllItems"
  | "name"
  | "subject"
  | "dueAt"
  | "done"
  | "createdAt"
  | "updatedAt"
  | "deleted"
  | "firstId"
  | "totalCount"
  | "matchesFilter"
  | "matchingBranchId"
  | "resumeAt"
  | "expectedCloseDate";

export interface MappingTarget {
  nodeId: string;
  path: readonly string[];
  contract: MappingValueContract;
  required: boolean;
  mode: "binding" | "literal-only";
  customFieldId?: string;
  literalContext?: "decimal" | "decimal-fragment";
  acceptedKinds?: readonly MappingValueKind[];
}

export interface MappingOutput {
  nodeId: string;
  path: readonly string[];
  contract: MappingValueContract;
  field: MappingFieldKey;
  label?: string;
  needsConfiguration?: true;
}

export type MappingAvailability =
  | "available"
  | "source-missing"
  | "not-upstream"
  | "ambiguous-path"
  | "unsupported-source"
  | "unknown-output"
  | "metadata-incomplete";
export type MappingCompatibility = "compatible" | "runtime-value-check" | "incompatible";

export type MappingTargetResult =
  | { state: "ready"; target: MappingTarget }
  | { state: "unavailable"; reason: MappingAvailability; issues: ConfigurationIssue[] };

export interface MappingCatalog {
  state: "ready" | "incomplete" | "denied";
  outputs: MappingOutput[];
  pathIssue?: MappingAvailability;
}

export interface MappingInspection {
  availability: MappingAvailability;
  compatibility: MappingCompatibility;
  source?: MappingOutput;
  target?: MappingTarget;
  issues: ConfigurationIssue[];
  runtimeChecks: readonly (readonly string[])[];
}

export type MappingPreview =
  | {
      state: "literal";
      presence: "omitted" | "null" | "value";
      value?: unknown;
      intent: MappingValueKind | "null";
      valid: boolean;
      issues: ConfigurationIssue[];
    }
  | {
      state: "reference";
      source: MappingOutput;
      possibleNull: boolean;
      runtimeOnly: true;
      example: {
        synthetic: true;
        kind: MappingValueKind;
        value?: string | number | boolean | null;
      };
      issues: ConfigurationIssue[];
    }
  | {
      state: "unavailable";
      reason: MappingAvailability;
      source?: MappingOutput;
      issues: ConfigurationIssue[];
    };
