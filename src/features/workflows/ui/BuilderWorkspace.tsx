"use client";

import { LayoutGrid, Maximize2, Plus } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { type ConnectionProblem, edgeId, insertNode, removeNode } from "../graphEditor";
import { type CreatableNodeType, makeNode } from "../nodeFactory";
import { arrangeGraph, positionFor } from "../nodeLayout";
import { displayNodeName, nodeLabelKeys } from "../nodeNames";
import type { DefinitionIssue, WorkflowDefinition } from "../schemas";
import { BuilderFrame } from "./BuilderFrame";
import { ConnectionEditor } from "./ConnectionEditor";
import { DefinitionIssues } from "./DefinitionIssues";
import { EdgeInspector } from "./EdgeInspector";
import { NodeInspector } from "./NodeInspector";
import { NodePalette } from "./NodePalette";
import { WorkflowCanvas } from "./WorkflowCanvas";

export function BuilderWorkspace({
  definition,
  onChange,
  editable,
  issues,
}: {
  definition: WorkflowDefinition;
  onChange: Dispatch<SetStateAction<WorkflowDefinition>>;
  editable: boolean;
  issues: DefinitionIssue[];
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const [expanded, setExpanded] = useState(false);
  const focusButton = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState(definition.nodes[0]?.id ?? "start");
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [problem, setProblem] = useState<ConnectionProblem | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const node = definition.nodes.find((item) => item.id === selected);
  const edge = definition.edges.find((item) => edgeId(item) === selectedEdge);
  const invalidNodes = new Set(
    issues.flatMap((issue) => (issue.nodeId === undefined ? [] : [issue.nodeId])),
  );
  function select(id: string) {
    setSelected(id);
    setSelectedEdge(null);
  }
  function add(type: CreatableNodeType) {
    const id = "node_" + crypto.randomUUID().slice(0, 8);
    const position = positionFor(definition, selected);
    const next = makeNode(definition, type, id, t(nodeLabelKeys[type]), t("subject"));
    onChange(insertNode(definition, next, { x: position.x + 360, y: position.y + 160 }));
    select(id);
    setPalette(false);
    setLayoutRevision((value) => value + 1);
  }
  return (
    <BuilderFrame expanded={expanded} onExpandedChange={setExpanded} returnFocus={focusButton}>
      <div className="xl:flex xl:h-full xl:min-h-0 xl:flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/15 px-5 py-3 pe-12">
          <p className="max-w-xl text-xs leading-5 text-muted-foreground">{t("connectHint")}</p>
          <div className="flex flex-wrap gap-2">
            {!expanded && (
              <Tip label={t("focusCanvas")}>
                <Button
                  ref={focusButton}
                  variant="ghost"
                  size="sm"
                  aria-label={t("focusCanvas")}
                  onClick={() => setExpanded(true)}
                >
                  <Maximize2 className="size-4" />
                </Button>
              </Tip>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!editable || definition.nodes.length >= 100}
              onClick={() => setPalette(true)}
            >
              <Plus className="size-4" />
              {t("addNode")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("arrange")}
              title={t("arrange")}
              disabled={!editable}
              onClick={() => {
                onChange(arrangeGraph(definition));
                setLayoutRevision((value) => value + 1);
              }}
            >
              <LayoutGrid className="size-4" />
              <span className="hidden sm:inline">{t("arrange")}</span>
            </Button>
          </div>
        </div>
        {problem !== null && (
          <p role="alert" className="border-b bg-destructive/5 px-5 py-3 text-sm text-destructive">
            {t(`connectionErrors.${problem}`)}
          </p>
        )}
        <div className="grid min-w-0 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_350px]">
          <div className="min-w-0 xl:flex xl:min-h-0 xl:flex-col">
            <nav
              aria-label={t("steps")}
              className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 [&>button]:shrink-0"
            >
              {definition.nodes.map((item, index) => (
                <Button
                  key={item.id}
                  variant={selected === item.id && selectedEdge === null ? "outline" : "ghost"}
                  size="sm"
                  aria-pressed={selected === item.id && selectedEdge === null}
                  onClick={() => select(item.id)}
                  title={displayNodeName(item, locale)}
                >
                  <bdi className="text-muted-foreground">{fmt.number(index + 1)}</bdi>
                  <bdi className="block max-w-36 truncate">{displayNodeName(item, locale)}</bdi>
                </Button>
              ))}
            </nav>
            <WorkflowCanvas
              definition={definition}
              selected={selected}
              selectedEdge={selectedEdge}
              onSelect={select}
              onSelectEdge={setSelectedEdge}
              onChange={onChange}
              onProblem={setProblem}
              editable={editable}
              invalidNodes={invalidNodes}
              layoutRevision={layoutRevision}
            />
          </div>
          <aside
            className="min-w-0 border-t bg-card xl:min-h-0 xl:overflow-y-auto xl:border-s xl:border-t-0"
            aria-label={t("configure")}
          >
            <DefinitionIssues definition={definition} issues={issues} onSelect={select} />
            {edge !== undefined ? (
              <EdgeInspector
                definition={definition}
                edge={edge}
                editable={editable}
                onChange={onChange}
                onProblem={setProblem}
                onClose={() => setSelectedEdge(null)}
              />
            ) : node !== undefined ? (
              <>
                <NodeInspector
                  definition={definition}
                  node={node}
                  editable={editable}
                  onChange={(changed) =>
                    onChange((graph) => ({
                      ...graph,
                      nodes: graph.nodes.map((item) => (item.id === changed.id ? changed : item)),
                    }))
                  }
                  onRemove={() => {
                    onChange((graph) => removeNode(graph, node.id));
                    select(definition.nodes[0]?.id ?? "start");
                  }}
                />
                <ConnectionEditor
                  definition={definition}
                  node={node}
                  editable={editable}
                  onChange={onChange}
                  onProblem={setProblem}
                />
              </>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">{t("configureHint")}</p>
            )}
          </aside>
        </div>
        <NodePalette open={palette} onClose={() => setPalette(false)} onAdd={add} />
      </div>
    </BuilderFrame>
  );
}
