import type { ReactNode } from "react";
import { assert } from "vitest";
import { Button } from "@/components/ui/Button";
import { LocaleProvider, useAppTranslations } from "@/features/i18n/LocaleProvider";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "../schemas";
import { ConditionFields } from "./ConditionFields";
import { mappingLocales, prepareMappingDom } from "./mapping.TestHelpers";
import { useGraphHistory } from "./useGraphHistory";

export type ConfigValue = WorkflowNode["config"][string];
export type ConfigObject = { [key: string]: ConfigValue };
export const groupCopy = {
  en: {
    all: "All conditions (AND)",
    any: "Any condition (OR)",
    match: "Match conditions",
    row: "Condition",
    group: "Condition group",
    add: "Add condition",
    addGroup: "Add group",
    remove: "Remove condition",
    earlier: "Move earlier",
    later: "Move later",
    convert: "Convert to group",
    otherwise: "Otherwise (default)",
    empty: "Empty text",
    omitted: "Not configured",
    invalid: "Invalid value",
    expand: "Show all conditions",
    bound: "Condition limit reached",
  },
  de: {
    all: "Alle Bedingungen (UND)",
    any: "Mindestens eine Bedingung (ODER)",
    match: "Bedingungen verknüpfen",
    row: "Bedingung",
    group: "Bedingungsgruppe",
    add: "Bedingung hinzufügen",
    addGroup: "Gruppe hinzufügen",
    remove: "Bedingung entfernen",
    earlier: "Nach oben",
    later: "Nach unten",
    convert: "In Gruppe umwandeln",
    otherwise: "Andernfalls (Standardpfad)",
    empty: "Leerer Text",
    omitted: "Nicht konfiguriert",
    invalid: "Ungültiger Wert",
    expand: "Alle Bedingungen anzeigen",
    bound: "Bedingungsgrenze erreicht",
  },
  fa: {
    all: "همهٔ شرط‌ها (و)",
    any: "حداقل یک شرط (یا)",
    match: "ترکیب شرط‌ها",
    row: "شرط",
    group: "گروه شرط",
    add: "افزودن شرط",
    addGroup: "افزودن گروه",
    remove: "حذف شرط",
    earlier: "انتقال به بالا",
    later: "انتقال به پایین",
    convert: "تبدیل به گروه",
    otherwise: "در غیر این صورت (مسیر پیش‌فرض)",
    empty: "متن خالی",
    omitted: "تنظیم نشده",
    invalid: "مقدار نامعتبر",
    expand: "نمایش همهٔ شرط‌ها",
    bound: "به محدودیت شرط‌ها رسیده‌اید",
  },
} as const;
export const groupLocales = mappingLocales.map((context) => ({
  ...context,
  groups: groupCopy[context.locale],
}));
export type GroupLocale = (typeof groupLocales)[number];
export const englishGroups = groupCopy.en;
export const reference = (field: string) => ({
  kind: "reference" as const,
  nodeId: "read",
  path: [field],
});
export const literal = (value: string | number | boolean | null) => ({
  kind: "value" as const,
  value,
});
export function predicate(
  id: string,
  left: ConfigValue = reference("title"),
  operator = "equals",
  right?: ConfigValue,
): ConfigValue {
  return { kind: "predicate", id, left, operator, ...(right === undefined ? {} : { right }) };
}
export function group(id: string, operator: "and" | "or", children: ConfigValue[]): ConfigValue {
  return { kind: "group", id, operator, children };
}
export function grouped(
  children: ConfigValue[] = [
    predicate("title_rule", reference("title"), "equals", literal("Customer")),
    predicate("value_rule", reference("value"), "equals", literal("0012.3400")),
  ],
): WorkflowNode["config"] {
  return { expression: group("all_rules", "and", children), defaultPort: "false" };
}
export function flat(): WorkflowNode["config"] {
  return {
    right: literal("open"),
    operator: "equals",
    left: { path: ["status"], kind: "reference", nodeId: "read" },
  };
}
export function fixture(config: WorkflowNode["config"] = grouped()) {
  const node: WorkflowNode = {
    id: "check",
    type: "condition",
    version: 1,
    name: "Qualify opportunity",
    nameMode: "custom",
    config,
  };
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "trigger.manual",
        version: 1,
        name: "Manual start",
        nameMode: "custom",
        config: {},
      },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read opportunity",
        nameMode: "custom",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      node,
      {
        id: "matched",
        type: "activity.create",
        version: 1,
        name: "Matched path",
        nameMode: "custom",
        config: { subject: literal("Matched opportunity"), dealId: reference("id") },
      },
      {
        id: "otherwise",
        type: "activity.create",
        version: 1,
        name: "Default path",
        nameMode: "custom",
        config: { subject: literal("Other opportunity"), dealId: reference("id") },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "check", port: "next" },
      { from: "check", to: "matched", port: "true" },
      { from: "check", to: "otherwise", port: "false" },
    ],
  };
  return { definition, node };
}
export function object(value: ConfigValue | undefined): ConfigObject {
  assert(
    value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value;
}
function configArray(value: ConfigValue | undefined): value is ConfigValue[] {
  return Array.isArray(value);
}
export function children(value: ConfigValue | undefined): ConfigValue[] {
  const found = object(value).children;
  assert(configArray(found));
  return found;
}
export function conditionNode(definition: WorkflowDefinition): WorkflowNode {
  const node = definition.nodes.find((item) => item.id === "check");
  assert(node !== undefined);
  return node;
}
export function graphFromOutput(container: HTMLElement): WorkflowDefinition {
  const text = container.querySelector("output[data-graph]")?.textContent;
  assert(typeof text === "string");
  return definitionSchema.parse(JSON.parse(text));
}
export function GroupLocaleProvider({
  context,
  children,
}: {
  context: GroupLocale;
  children: ReactNode;
}) {
  return (
    <LocaleProvider
      locale={context.locale}
      calendar={context.calendar}
      numberingSystem={context.numberingSystem}
      timeZone={context.timeZone}
    >
      {children}
    </LocaleProvider>
  );
}
export function HistoryEditor({
  initial,
  changed,
  editable = true,
}: {
  initial: WorkflowDefinition;
  changed: (node: WorkflowNode) => void;
  editable?: boolean;
}) {
  const t = useAppTranslations("workflows");
  const history = useGraphHistory(initial);
  const node = conditionNode(history.definition);
  return (
    <>
      <ConditionFields
        definition={history.definition}
        node={node}
        metadata={{ status: "complete", defs: [] }}
        editable={editable}
        onChange={(next) => {
          changed(next);
          history.setDefinition((current) => ({
            ...current,
            nodes: current.nodes.map((item) => (item.id === next.id ? next : item)),
          }));
        }}
      />
      <Button disabled={!history.canUndo} onClick={history.undo}>
        {t("undo")}
      </Button>
      <Button disabled={!history.canRedo} onClick={history.redo}>
        {t("redo")}
      </Button>
      <output data-graph>{JSON.stringify(history.definition)}</output>
    </>
  );
}
export function prepareGroupDom() {
  prepareMappingDom();
}
