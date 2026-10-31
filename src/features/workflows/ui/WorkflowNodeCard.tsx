"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { CirclePlay, Database, GitBranch, ListTodo, TriangleAlert } from "lucide-react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { portsFor } from "../graphEditor";
import { displayNodeName, nodeLabelKeys } from "../nodeNames";
import type { WorkflowNode } from "../schemas";

export type CanvasNode = Node<{ node: WorkflowNode; invalid: boolean; index: number }, "workflow">;
export function WorkflowNodeCard({ data, selected, isConnectable }: NodeProps<CanvasNode>) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const { node } = data;
  const Icon =
    node.type === "trigger.manual"
      ? CirclePlay
      : node.type === "record.read"
        ? Database
        : node.type === "condition"
          ? GitBranch
          : ListTodo;
  const ports = portsFor(node);
  return (
    <section
      dir={directionForLocale(locale)}
      className={cn(
        "relative w-72 rounded-xl border bg-card p-5 text-start shadow-sm",
        selected ? "border-primary ring-2 ring-primary/20" : "border-border",
        data.invalid && "border-destructive/60",
      )}
    >
      {!node.type.startsWith("trigger.") && (
        <Handle
          id="in"
          type="target"
          position={Position.Top}
          isConnectable={isConnectable}
          aria-label={t("inputPort")}
        />
      )}
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">
            {t(nodeLabelKeys[node.type])} · {fmt.number(data.index + 1)}
          </p>
          <p dir="auto" className="mt-1 line-clamp-2 text-sm font-semibold leading-5">
            {displayNodeName(node, locale)}
          </p>
        </div>
        {data.invalid && (
          <TriangleAlert className="size-4 shrink-0 text-destructive" aria-label={t("invalid")} />
        )}
      </div>
      {ports.length > 1 && (
        <div
          dir="ltr"
          className="mt-4 grid grid-cols-2 gap-2 border-t pt-3 text-center text-xs font-medium"
        >
          {ports.map((port) => (
            <span key={port} dir={directionForLocale(locale)}>
              {t(port === "true" ? "truePort" : "falsePort")}
            </span>
          ))}
        </div>
      )}
      {ports.map((port, index) => (
        <Handle
          key={port}
          id={port}
          type="source"
          position={Position.Bottom}
          isConnectable={isConnectable}
          style={{ left: ports.length === 1 ? "50%" : index === 0 ? "25%" : "75%" }}
          aria-label={t(port === "true" ? "truePort" : port === "false" ? "falsePort" : "nextPort")}
        />
      ))}
    </section>
  );
}
