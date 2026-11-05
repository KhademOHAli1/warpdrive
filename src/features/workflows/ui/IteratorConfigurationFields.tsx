"use client";

import { Braces, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { ConfigurationValidation } from "../configurationTypes";
import { displayNodeName } from "../nodeNames";
import { orderedWorkflowNodes } from "../nodeOrder";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import {
  workflowIteratorConfig,
  workflowIteratorSearchSources,
} from "../workflowIteratorRuntimeContract";
import { configurationIssueKeys } from "./configurationIssueMessage";
import { emptyIteratorItems, IteratorLiteralList } from "./IteratorLiteralList";
import styles from "./workflowInspector.module.css";

const copy = {
  en: {
    items: "Items to iterate over",
    source: "List source",
    literal: "Literal list",
    results: "All records",
    continue: "Continue on iteration failure",
    hint: "Continue to the next item if the current iteration fails.",
  },
  de: {
    items: "Elemente für die Schleife",
    source: "Listenquelle",
    literal: "Feste Liste",
    results: "Alle Datensätze",
    continue: "Bei Fehler in der Schleife fortfahren",
    hint: "Wenn eine Iteration fehlschlägt, mit dem nächsten Element fortfahren.",
  },
  fa: {
    items: "موارد برای تکرار",
    source: "منبع فهرست",
    literal: "فهرست ثابت",
    results: "همهٔ رکوردها",
    continue: "ادامه پس از خطای تکرار",
    hint: "اگر تکرار کنونی ناموفق بود، با مورد بعدی ادامه دهید.",
  },
};

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
}

const sourceOption = (nodeId: string) => `search:${nodeId}`;

export function IteratorConfigurationFields({
  definition,
  node,
  editable,
  onChange,
  validation,
}: Props) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const text = copy[locale];
  const format = useFormatters();
  const id = useId();
  const parsed = workflowIteratorConfig.safeParse({ items: node.config.items });
  const items = parsed.success ? parsed.data.items : emptyIteratorItems;
  const sources = workflowIteratorSearchSources(definition, node.id);
  const order = orderedWorkflowNodes(definition).map((entry) => entry.id);
  const options = sources.map((source) => ({
    value: sourceOption(source.id),
    label: `${text.results} · ${displayNodeName(source, locale)} ${format.number(order.indexOf(source.id) + 1)}`,
  }));
  const selected = items.kind === "reference" ? sourceOption(items.nodeId) : "literal";
  const currentSource = options.find((option) => option.value === selected);
  const issue = validation.issues.find((entry) => entry.path[0] === "items");
  const error = issue === undefined ? undefined : t(configurationIssueKeys[issue.code]);
  const hintId = `${id}-continue-hint`;
  const errorId = error === undefined ? undefined : `${id}-items-error`;

  function change(patch: WorkflowNode["config"]) {
    if (editable) onChange({ ...node, config: { ...node.config, ...patch } });
  }

  return (
    <div className="space-y-4">
      <fieldset className={styles.field} aria-describedby={errorId}>
        <legend className={styles.label}>{text.items}</legend>
        <div className="flex min-w-0 items-center gap-1">
          {items.kind === "literal" ? (
            <IteratorLiteralList
              key={node.id}
              label={text.items}
              value={items}
              editable={editable}
              invalid={error !== undefined}
              describedBy={errorId}
              onChange={(next) => change({ items: next })}
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-between gap-1 rounded-lg border border-[var(--workflow-border-medium)] px-2">
              <bdi className="truncate py-1.5">{currentSource?.label ?? t("unavailableValue")}</bdi>
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-7 shrink-0 p-0"
                  aria-label={t("mappingRemove")}
                  onClick={() => change({ items: emptyIteratorItems })}
                >
                  <X aria-hidden="true" size={14} />
                </Button>
              )}
            </div>
          )}
          {editable && (
            <Select
              ariaLabel={text.source}
              value={currentSource?.value ?? "literal"}
              options={[{ value: "literal", label: text.literal }, ...options]}
              disabled={options.length === 0}
              triggerClassName="w-auto shrink-0 gap-1"
              triggerContent={<Braces aria-hidden="true" size={14} />}
              onChange={(next) => {
                if (next === "literal") change({ items: emptyIteratorItems });
                else {
                  const source = sources.find((entry) => sourceOption(entry.id) === next);
                  if (source !== undefined)
                    change({ items: { kind: "reference", nodeId: source.id, path: ["all"] } });
                }
              }}
            />
          )}
        </div>
        {error !== undefined && (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </fieldset>
      <fieldset className={styles.field} aria-label={text.continue} aria-describedby={hintId}>
        <div className="flex min-h-8 items-center justify-between gap-2 rounded-lg border border-[var(--workflow-border-medium)] px-2">
          <label htmlFor={`${id}-continue`}>{text.continue}</label>
          <Switch
            id={`${id}-continue`}
            label={text.continue}
            checked={node.config.shouldContinueOnIterationFailure === true}
            disabled={!editable}
            onCheckedChange={(checked) => change({ shouldContinueOnIterationFailure: checked })}
          />
        </div>
        <p id={hintId} className={styles.hint}>
          {text.hint}
        </p>
      </fieldset>
    </div>
  );
}
