"use client";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { type ConnectionProblem, connectNodes, disconnectNodes, portsFor } from "../graphEditor";
import { displayNodeName } from "../nodeNames";
import type { WorkflowDefinition, WorkflowEdge } from "../schemas";

export function EdgeInspector({
  definition,
  edge,
  editable,
  onChange,
  onProblem,
  onClose,
}: {
  definition: WorkflowDefinition;
  edge: WorkflowEdge;
  editable: boolean;
  onChange: (graph: WorkflowDefinition) => void;
  onProblem: (problem: ConnectionProblem | null) => void;
  onClose: () => void;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const source = definition.nodes.find((node) => node.id === edge.from);
  function change(next: WorkflowEdge) {
    const result = connectNodes(definition, next, edge);
    if (!result.ok) {
      onProblem(result.error);
      return;
    }
    onChange(result.value);
    onProblem(null);
    onClose();
  }
  const options = definition.nodes.map((node, index) => ({
    value: node.id,
    label: displayNodeName(node, locale) + " · " + fmt.number(index + 1),
  }));
  return (
    <section className="space-y-5 p-5" aria-label={t("connections")}>
      <h2 className="text-lg font-semibold">{t("connections")}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{t("reconnectHelp")}</p>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("connectionFrom")}</p>
        <Select
          ariaLabel={t("connectionFrom")}
          value={edge.from}
          options={options}
          disabled={!editable}
          onChange={(from) => {
            const node = definition.nodes.find((item) => item.id === from);
            if (node === undefined) return;
            const ports = portsFor(node);
            change({
              ...edge,
              from,
              port: ports.includes(edge.port) ? edge.port : (ports[0] ?? "next"),
            });
          }}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("connectionPort")}</p>
        <Select
          ariaLabel={t("connectionPort")}
          value={edge.port}
          disabled={!editable}
          options={(source === undefined ? [] : portsFor(source)).map((port) => ({
            value: port,
            label: t(port === "true" ? "truePort" : port === "false" ? "falsePort" : "nextPort"),
          }))}
          onChange={(port) => {
            if (source === undefined) return;
            const next = portsFor(source).find((item) => item === port);
            if (next !== undefined) change({ ...edge, port: next });
          }}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("connectionTarget")}</p>
        <Select
          ariaLabel={t("connectionTarget")}
          value={edge.to}
          disabled={!editable}
          options={options.filter(
            (option) =>
              definition.nodes
                .find((node) => node.id === option.value)
                ?.type.startsWith("trigger.") !== true,
          )}
          onChange={(to) => change({ ...edge, to })}
        />
      </div>
      <Button
        variant="outline"
        disabled={!editable}
        className="text-destructive"
        onClick={() => {
          onChange(disconnectNodes(definition, edge));
          onClose();
        }}
      >
        {t("removeConnection")}
      </Button>
    </section>
  );
}
