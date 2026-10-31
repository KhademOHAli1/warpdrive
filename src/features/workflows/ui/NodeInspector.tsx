"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { displayNodeName, isAutomaticNodeName } from "../nodeNames";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { BindingField } from "./BindingField";
import { ConditionFields } from "./ConditionFields";

export function NodeInspector({
  definition,
  node,
  editable,
  onChange,
  onRemove,
}: {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  onRemove: () => void;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const id = useId();
  const name = displayNodeName(node, locale);
  const automatic = isAutomaticNodeName(node);
  return (
    <section className="flex flex-col" aria-label={t("configure")}>
      <div className="border-b p-5">
        <p className="text-xs font-medium text-muted-foreground">{t("configure")}</p>
        <h2 dir="auto" className="mt-2 break-words text-lg font-semibold">
          {name}
        </h2>
      </div>
      <div className="space-y-5 p-5">
        <div className="space-y-3">
          <label htmlFor={id} className="text-sm font-medium">
            {t("stepName")}
          </label>
          <Input
            dir="auto"
            id={id}
            value={name}
            maxLength={120}
            disabled={!editable}
            onChange={(event) =>
              onChange({ ...node, name: event.target.value, nameMode: "custom" })
            }
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id={id + "-auto"}
              label={t("stepNameAutomatic")}
              checked={automatic}
              disabled={!editable}
              onCheckedChange={(value) =>
                onChange({ ...node, name, nameMode: value ? "automatic" : "custom" })
              }
            />
            <label className="text-xs text-muted-foreground" htmlFor={id + "-auto"}>
              {t("stepNameAutomatic")}
            </label>
          </div>
        </div>
        {node.type === "trigger.manual" && (
          <p className="text-sm leading-6 text-muted-foreground">{t("triggerHint")}</p>
        )}
        {node.type === "record.read" && (
          <>
            <p className="text-sm leading-6 text-muted-foreground">{t("readHint")}</p>
            <BindingField
              definition={definition}
              nodeId={node.id}
              value={node.config.recordId}
              onChange={(recordId) => onChange({ ...node, config: { ...node.config, recordId } })}
              kind="deal"
              label={t("recordIdLabel")}
              sourceLabel={t("recordSource")}
              editable={editable}
              allowLiteral={false}
            />
          </>
        )}
        {node.type === "activity.create" && (
          <>
            <p className="text-sm leading-6 text-muted-foreground">{t("taskHint")}</p>
            <BindingField
              definition={definition}
              nodeId={node.id}
              value={node.config.subject}
              onChange={(subject) => onChange({ ...node, config: { ...node.config, subject } })}
              kind="text"
              label={t("subjectLabel")}
              sourceLabel={t("subjectSource")}
              editable={editable}
            />
            <BindingField
              definition={definition}
              nodeId={node.id}
              value={node.config.dealId}
              onChange={(dealId) => onChange({ ...node, config: { ...node.config, dealId } })}
              kind="deal"
              label={t("linkedDeal")}
              sourceLabel={t("linkedDeal")}
              editable={editable}
              allowLiteral={false}
            />
          </>
        )}
        {node.type === "condition" && (
          <ConditionFields
            definition={definition}
            node={node}
            editable={editable}
            onChange={onChange}
          />
        )}
      </div>
      {!node.type.startsWith("trigger.") && editable && (
        <div className="mt-auto border-t p-5">
          <Button variant="ghost" className="text-destructive" onClick={onRemove}>
            {t("remove")}
          </Button>
        </div>
      )}
    </section>
  );
}
