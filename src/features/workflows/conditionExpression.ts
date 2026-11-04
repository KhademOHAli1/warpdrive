import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import {
  conditionBudgetWalk,
  conditionRecord,
  type RawConditionEntry,
  rawConditionGroup,
} from "./conditionExpressionBudget";
import type { ConfigurationIssue } from "./configurationTypes";
import { type Binding, bindingSchema, copyScalarBindingSchema } from "./schemas";

export type ConditionParseMode = "draft" | "execute" | "copy";
export type PredicateOperator = "exists" | "equals" | "notEquals" | "contains" | "isEmpty";
export type LegacyPredicateOperator = Exclude<PredicateOperator, "isEmpty"> | "greaterThan";
export type ConditionExpressionIssue = Pick<ConfigurationIssue, "path" | "code" | "params">;
type PartialBinding = z.infer<typeof copyScalarBindingSchema>;
export interface ConditionPredicate {
  kind: "predicate";
  id: string;
  left: Binding;
  operator: PredicateOperator;
  right?: Binding;
}
export interface ConditionGroup {
  kind: "group";
  id: string;
  operator: "and" | "or";
  children: (ConditionPredicate | ConditionGroup)[];
}
export interface GroupedConditionConfig {
  expression: ConditionGroup;
  defaultPort: "false";
}
export interface LegacyConditionConfig {
  left: Binding;
  operator: LegacyPredicateOperator;
  right?: Binding;
}
export interface ConditionPredicateDraft {
  kind?: "predicate";
  id?: string;
  left?: PartialBinding;
  operator?: PredicateOperator;
  right?: PartialBinding;
}
export interface ConditionGroupDraft {
  kind?: "group";
  id?: string;
  operator?: "and" | "or";
  children?: ConditionExpressionDraft[];
}
export type ConditionExpressionDraft = ConditionPredicateDraft | ConditionGroupDraft;
export interface GroupedConditionDraft {
  expression?: ConditionGroupDraft;
  defaultPort?: "false";
}
export interface LegacyConditionDraft {
  left?: PartialBinding;
  operator?: LegacyPredicateOperator;
  right?: PartialBinding;
}
export interface ConditionPredicateEntry {
  id: string | undefined;
  path: readonly string[];
  predicate: ConditionPredicateDraft;
}
export type ParsedConditionConfig =
  | { kind: "legacy"; config: LegacyConditionDraft; entries: ConditionPredicateEntry[] }
  | { kind: "grouped"; config: GroupedConditionDraft; entries: ConditionPredicateEntry[] };
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const groupOperators: readonly string[] = ["and", "or"];
const predicateOperators: readonly string[] = [
  "exists",
  "equals",
  "notEquals",
  "contains",
  "isEmpty",
];
const legacyOperators: readonly string[] = [
  "exists",
  "equals",
  "notEquals",
  "contains",
  "greaterThan",
];
function issue(
  path: readonly string[],
  code: ConfigurationIssue["code"],
): ConditionExpressionIssue {
  return { path, code };
}
function unknownKeys(
  raw: Record<string, unknown>,
  keys: readonly string[],
  path: readonly string[],
): ConditionExpressionIssue[] {
  return Object.keys(raw)
    .filter((key) => !keys.includes(key))
    .map(() => issue(path, "unknown_setting"));
}
function member(
  raw: Record<string, unknown>,
  key: string,
  path: readonly string[],
  mode: ConditionParseMode,
  choices: readonly string[],
): ConditionExpressionIssue[] {
  if (!Object.hasOwn(raw, key))
    return mode === "execute" ? [issue([...path, key], "required")] : [];
  const value = raw[key];
  return typeof value === "string" && choices.includes(value)
    ? []
    : [issue([...path, key], "invalid_value")];
}
function binding(
  raw: Record<string, unknown>,
  key: string,
  path: readonly string[],
  mode: ConditionParseMode,
  required: boolean,
): ConditionExpressionIssue[] {
  if (!Object.hasOwn(raw, key))
    return mode === "execute" && required ? [issue([...path, key], "required")] : [];
  const schema = mode === "execute" ? bindingSchema : copyScalarBindingSchema;
  return schema.safeParse(raw[key]).success ? [] : [issue([...path, key], "invalid_value")];
}
function unary(operator: unknown): boolean {
  return operator === "exists" || operator === "isEmpty";
}
function predicateIssues(
  raw: Record<string, unknown>,
  path: readonly string[],
  mode: ConditionParseMode,
  legacy: boolean,
): ConditionExpressionIssue[] {
  const keys = legacy ? ["left", "operator", "right"] : ["kind", "id", "left", "operator", "right"];
  return [
    ...unknownKeys(raw, keys, path),
    ...member(raw, "operator", path, mode, legacy ? legacyOperators : predicateOperators),
    ...binding(raw, "left", path, mode, true),
    ...binding(raw, "right", path, mode, !unary(raw.operator)),
  ];
}
function identityIssues(
  raw: Record<string, unknown>,
  path: readonly string[],
  mode: ConditionParseMode,
  ids: Set<string>,
): ConditionExpressionIssue[] {
  if (!Object.hasOwn(raw, "id"))
    return mode === "execute" ? [issue([...path, "id"], "required")] : [];
  if (!identifier.safeParse(raw.id).success || typeof raw.id !== "string")
    return [issue([...path, "id"], "invalid_value")];
  if (ids.has(raw.id)) return [issue([...path, "id"], "invalid_value")];
  ids.add(raw.id);
  return [];
}
function groupIssues(
  raw: Record<string, unknown>,
  path: readonly string[],
  mode: ConditionParseMode,
): ConditionExpressionIssue[] {
  const issues = [
    ...unknownKeys(raw, ["kind", "id", "operator", "children"], path),
    ...member(raw, "operator", path, mode, groupOperators),
  ];
  if (!Object.hasOwn(raw, "children"))
    return [...issues, ...(mode === "execute" ? [issue([...path, "children"], "required")] : [])];
  if (!Array.isArray(raw.children))
    return [...issues, issue([...path, "children"], "invalid_value")];
  if (mode === "execute" && raw.children.length === 0)
    issues.push(issue([...path, "children"], "required"));
  return issues;
}
function expressionIssues(
  entry: RawConditionEntry,
  mode: ConditionParseMode,
  ids: Set<string>,
): ConditionExpressionIssue[] {
  if (!conditionRecord(entry.raw)) return [issue(entry.path, "invalid_value")];
  const raw = entry.raw;
  const grouped = entry.path.length === 1 || rawConditionGroup(raw);
  const kind = grouped ? "group" : "predicate";
  return [
    ...identityIssues(raw, entry.path, mode, ids),
    ...member(raw, "kind", entry.path, mode, [kind]),
    ...(grouped
      ? groupIssues(raw, entry.path, mode)
      : predicateIssues(raw, entry.path, mode, false)),
  ];
}
function rootGroupIssues(
  raw: Record<string, unknown>,
  mode: ConditionParseMode,
): ConditionExpressionIssue[] {
  const issues = [
    ...unknownKeys(raw, ["expression", "defaultPort"], []),
    ...member(raw, "defaultPort", [], mode, ["false"]),
  ];
  if (!Object.hasOwn(raw, "expression"))
    return [...issues, ...(mode === "execute" ? [issue(["expression"], "required")] : [])];
  if (!conditionRecord(raw.expression)) issues.push(issue(["expression"], "invalid_value"));
  return issues;
}
function knownJson(
  raw: Record<string, unknown>,
  issues: ConditionExpressionIssue[],
): ConditionExpressionIssue[] {
  if (issues.length > 0) return issues;
  return z.json().safeParse(raw).success ? [] : [issue([], "invalid_value")];
}
function groupedConfig(
  raw: Record<string, unknown>,
  mode: ConditionParseMode,
): Result<ParsedConditionConfig, ConditionExpressionIssue[]> {
  const budget = conditionBudgetWalk(raw);
  if (!budget.ok) return budget;
  const ids = new Set<string>();
  const issues = knownJson(raw, [
    ...rootGroupIssues(raw, mode),
    ...budget.value.flatMap((entry) => expressionIssues(entry, mode, ids)),
  ]);
  if (issues.length > 0) return err(issues);
  const config = structuredClone(raw) as GroupedConditionDraft;
  const entries = budget.value
    .filter(
      (entry) =>
        entry.path.length > 1 && conditionRecord(entry.raw) && !rawConditionGroup(entry.raw),
    )
    .map(
      (entry): ConditionPredicateEntry => ({
        id:
          typeof entry.raw === "object" &&
          entry.raw !== null &&
          "id" in entry.raw &&
          typeof entry.raw.id === "string"
            ? entry.raw.id
            : undefined,
        path: [...entry.path],
        predicate: structuredClone(entry.raw) as ConditionPredicateDraft,
      }),
    );
  return ok({ kind: "grouped", config, entries });
}
export function parseConditionConfig(
  raw: unknown,
  mode: ConditionParseMode,
): Result<ParsedConditionConfig, ConditionExpressionIssue[]> {
  if (!conditionRecord(raw)) return err([issue([], "invalid_value")]);
  if (Object.hasOwn(raw, "expression") || Object.hasOwn(raw, "defaultPort"))
    return groupedConfig(raw, mode);
  const issues = knownJson(raw, predicateIssues(raw, [], mode, true));
  if (issues.length > 0) return err(issues);
  const config = structuredClone(raw) as LegacyConditionDraft;
  return ok({
    kind: "legacy",
    config,
    entries: [
      {
        id: "legacy",
        path: [],
        predicate: {
          ...config,
          kind: "predicate",
          id: "legacy",
          operator: config.operator === "greaterThan" ? undefined : config.operator,
        },
      },
    ],
  });
}
export function conditionPredicates(
  parsed: ParsedConditionConfig,
): readonly ConditionPredicateEntry[] {
  return parsed.entries;
}
export function findConditionPredicate(
  parsed: ParsedConditionConfig,
  id: string,
): ConditionPredicateEntry | undefined {
  return parsed.entries.find((entry) => entry.id === id);
}
export function conditionOperandEntry(
  parsed: ParsedConditionConfig,
  path: readonly string[],
): { entry: ConditionPredicateEntry; operand: "left" | "right" } | undefined {
  const operand = path.at(-1);
  if (operand !== "left" && operand !== "right") return undefined;
  const prefix = path.slice(0, -1);
  const entry = parsed.entries.find(
    (item) =>
      item.path.length === prefix.length &&
      item.path.every((part, index) => part === prefix[index]),
  );
  return entry === undefined ? undefined : { entry, operand };
}
