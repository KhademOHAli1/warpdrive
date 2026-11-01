"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { type ConnectionProblem, connectNodes, disconnectNodes, portsFor } from "../graphEditor";
import { displayNodeName } from "../nodeNames";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import type { AddFromOutput } from "./useConnectionGestures";

export function ConnectionEditor({
  definition,
  node,
  editable,
  onChange,
  onProblem,
  onAdd,
}: {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (graph: WorkflowDefinition) => void;
  onProblem: (problem: ConnectionProblem | null) => void;
  onAdd?: AddFromOutput;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  return (
    <section className="space-y-4 border-t p-5" aria-label={t("connections")}>
      <h3 className="text-sm font-semibold">{t("connections")}</h3>
      <p className="text-xs leading-5 text-muted-foreground">{t("connectionHelp")}</p>
      {portsFor(node).map((port) => {
        const existing = definition.edges.find(
          (edge) => edge.from === node.id && edge.port === port,
        );
        const label = t(port === "true" ? "truePort" : port === "false" ? "falsePort" : "nextPort");
        return (
          <div key={port} className="space-y-2">
            <p className="text-xs font-medium">{label}</p>
            <Select
              ariaLabel={label}
              disabled={!editable}
              value={existing?.to ?? ""}
              options={[
                { value: "", label: t("unconnected") },
                ...definition.nodes
                  .filter((target) => target.id !== node.id && !target.type.startsWith("trigger."))
                  .map((target) => ({
                    value: target.id,
                    label:
                      displayNodeName(target, locale) +
                      " · " +
                      fmt.number(definition.nodes.findIndex((item) => item.id === target.id) + 1),
                  })),
              ]}
              onChange={(target) => {
                if (target === "") {
                  if (existing !== undefined) onChange(disconnectNodes(definition, existing));
                  onProblem(null);
                  return;
                }
                const result = connectNodes(
                  definition,
                  { from: node.id, to: target, port },
                  existing,
                );
                if (!result.ok) {
                  onProblem(result.error);
                  return;
                }
                onChange(result.value);
                onProblem(null);
              }}
            />
            {existing === undefined && onAdd !== undefined && (
              <Button
                variant="outline"
                size="sm"
                disabled={!editable || definition.nodes.length >= 100}
                className="w-full"
                onClick={() => onAdd({ from: node.id, port })}
              >
                <Plus className="size-3.5" />
                {t("addConnectedStep")}
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}
