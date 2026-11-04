import type { CustomFieldType } from "@/constants/customFieldTypes";
import type { CustomFieldDef } from "@/types/customFields";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

export type ConfigurationPath = readonly string[];
export type ConfigurationIssueCode =
  | "required"
  | "invalid_type"
  | "invalid_value"
  | "too_long"
  | "out_of_range"
  | "unknown_setting"
  | "unknown_field"
  | "field_archived"
  | "option_unavailable"
  | "reference_missing"
  | "reference_incompatible"
  | "reference_unavailable"
  | "unsupported_setting"
  | "metadata_incomplete"
  | "metadata_stale";

export interface ConfigurationIssue {
  nodeId: string;
  path: ConfigurationPath;
  code: ConfigurationIssueCode;
  params?: Readonly<Record<string, string | number>>;
}

export type ConfigurationMetadata =
  | { status: "complete"; defs: readonly CustomFieldDef[]; fingerprint?: string }
  | {
      status: "loading" | "incomplete" | "stale" | "error" | "denied";
      defs?: readonly CustomFieldDef[];
      fingerprint?: string;
    };

export interface ConfigurationContext {
  definition: WorkflowDefinition;
  metadata?: ConfigurationMetadata;
}

export interface ConfigurationValidation {
  status: "valid" | "invalid" | "incomplete-metadata";
  issues: ConfigurationIssue[];
  runtimeChecks: ConfigurationPath[];
}

export type ConfigurationMode = "literal" | "reference" | "null" | "omit";
export type ConfigurationValueKind =
  | CustomFieldType
  | "string"
  | "boolean"
  | "deal"
  | "scalar"
  | "operator"
  | "entity"
  | "node-name";

export interface ConfigurationConstraints {
  minLength?: number;
  maxLength?: number;
  trim?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface ConfigurationFieldSpec {
  path: string[];
  label: string;
  labelSource: "translation" | "metadata";
  control: "name" | "binding" | "operator" | "duration" | "entity" | "custom";
  valueType: ConfigurationValueKind;
  required: boolean;
  nullable: boolean;
  modes: ConfigurationMode[];
  constraints?: ConfigurationConstraints;
  requiredWhen?: { field: "operator"; not: "exists" };
  choices?: readonly string[];
  customField?: CustomFieldDef;
  readOnly?: boolean;
}

export interface ConfigurationProfile {
  supported: boolean;
  fields: ConfigurationFieldSpec[];
}

export interface ConfigurationSpec extends ConfigurationProfile {
  type: WorkflowNode["type"];
  version: 1;
}
