"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { bindingSchema } from "../schemas";

export function NodeInspector({
  node,
  editable,
  onChange,
  onRemove,
}: {
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  onRemove: () => void;
}) {
  const t = useAppTranslations("workflows");
  const id = useId();
  const binding = bindingSchema.safeParse(node.config.subject);
  const reference = binding.success && binding.data.kind === "reference";
  const subject =
    binding.success && binding.data.kind === "value" ? String(binding.data.value ?? "") : "";
  function changeSubject(value: string) {
    onChange({ ...node, config: { ...node.config, subject: { kind: "value", value } } });
  }
  return (
    <section className="flex h-full flex-col" aria-label={t("configure")}>
      <div className="border-b px-6 py-5">
        <p className="text-xs font-medium text-muted-foreground">{t("configure")}</p>
        <h2 className="mt-2 text-lg font-semibold">{node.name}</h2>
      </div>
      <div className="space-y-6 p-6">
        <div className="space-y-2">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            {t("stepName")}
          </label>
          <Input
            id={`${id}-name`}
            value={node.name}
            maxLength={120}
            disabled={!editable}
            onChange={(e) => onChange({ ...node, name: e.target.value })}
          />
        </div>
        {node.type === "trigger.manual" && (
          <p className="text-sm leading-6 text-muted-foreground">{t("triggerHint")}</p>
        )}
        {node.type === "record.read" && (
          <p className="text-sm leading-6 text-muted-foreground">{t("readHint")}</p>
        )}
        {node.type === "activity.create" && (
          <>
            <p className="text-sm leading-6 text-muted-foreground">{t("taskHint")}</p>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("subjectSource")}</p>
              <Select
                value={reference ? "deal" : "text"}
                ariaLabel={t("subjectSource")}
                disabled={!editable}
                options={[
                  { value: "text", label: t("customText") },
                  { value: "deal", label: t("dealTitle") },
                ]}
                onChange={(value) =>
                  value === "text"
                    ? changeSubject("")
                    : onChange({
                        ...node,
                        config: {
                          ...node.config,
                          subject: { kind: "reference", nodeId: "read", path: ["title"] },
                        },
                      })
                }
              />
            </div>
            {!reference && (
              <div className="space-y-2">
                <label htmlFor={`${id}-subject`} className="text-sm font-medium">
                  {t("subjectLabel")}
                </label>
                <Input
                  id={`${id}-subject`}
                  value={subject}
                  disabled={!editable}
                  maxLength={255}
                  onChange={(e) => changeSubject(e.target.value)}
                />
              </div>
            )}
          </>
        )}
      </div>
      {node.type === "activity.create" && editable && (
        <div className="mt-auto border-t p-6">
          <Button variant="ghost" className="text-destructive" onClick={onRemove}>
            {t("remove")}
          </Button>
        </div>
      )}
    </section>
  );
}
