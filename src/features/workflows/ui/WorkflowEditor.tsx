"use client";

import { ArrowLeft, ChevronRight, FlaskConical, Play, Plus, Save } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { appendTask, removeTask } from "../editorModel";
import { NodeInspector } from "./NodeInspector";
import { RunDialog } from "./RunDialog";
import { RunHistory } from "./RunHistory";
import { useWorkflowEditor, type WorkflowDetail } from "./useWorkflowEditor";
import { WorkflowCanvas } from "./WorkflowCanvas";

export function WorkflowEditor({ initial }: { initial: WorkflowDetail }) {
  const t = useAppTranslations("workflows");
  const utils = trpc.useUtils();
  const fmt = useFormatters();
  const editor = useWorkflowEditor(initial);
  const [selected, setSelected] = useState(initial.draft.nodes[0]?.id ?? "start");
  const [tab, setTab] = useState("configure");
  const [runMode, setRunMode] = useState<"simulation" | "live" | null>(null);
  const fieldId = useId();
  const node = editor.definition.nodes.find((item) => item.id === selected);
  const editable = initial.capabilities.edit && !editor.pending;
  const runnable = initial.capabilities.run && editor.active && !editor.pending;
  function addTask() {
    const id = `task_${crypto.randomUUID().slice(0, 8)}`;
    editor.setDefinition(appendTask(editor.definition, id, t("task"), t("subject")));
    setSelected(id);
  }
  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <h1 className="sr-only">{editor.name}</h1>
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/workflows"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <Badge variant="outline">{t("early")}</Badge>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <label htmlFor={fieldId} className="sr-only">
            {t("name")}
          </label>
          <Input
            id={fieldId}
            value={editor.name}
            disabled={!editable}
            maxLength={120}
            className="h-11 max-w-xl border-transparent px-0 text-display font-semibold shadow-none focus-visible:px-3 md:text-display"
            onChange={(e) => editor.setName(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge variant={editor.active ? "success" : "secondary"}>
              {editor.active ? t("active") : editor.number === null ? t("draft") : t("paused")}
            </Badge>
            <span>
              {editor.number === null ? t("notPublished") : t("version", { number: editor.number })}
            </span>
            {editor.dirty && <span>{t("unsaved")}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {initial.capabilities.edit && (
            <Button
              variant="outline"
              disabled={editor.pending || !editor.dirty}
              onClick={() => void editor.perform("save")}
            >
              <Save className="size-4" />
              {t("save")}
            </Button>
          )}
          {initial.capabilities.publish && (
            <Button
              disabled={editor.pending || editor.issues.length > 0 || editor.name.trim() === ""}
              onClick={() => void editor.perform("publish")}
            >
              {t("publish")}
            </Button>
          )}
          {editor.active && initial.capabilities.edit && (
            <Button
              variant="outline"
              title={t("pauseHint")}
              disabled={editor.pending}
              onClick={() => void editor.perform("pause")}
            >
              {t("pause")}
            </Button>
          )}
        </div>
      </header>
      {editor.error !== null && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          <IdentityActionError message={editor.error} />
        </div>
      )}
      {editor.notice !== null && (
        <p role="status" className="rounded-lg border bg-card p-4 text-sm">
          {editor.notice}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
            <TabsList className="gap-5">
              <TabsTrigger
                value="configure"
                className="border-b-2 border-transparent py-2 data-[state=active]:border-primary data-[state=active]:text-primary"
              >
                {t("configure")}
              </TabsTrigger>
              <TabsTrigger
                value="runs"
                className="border-b-2 border-transparent py-2 data-[state=active]:border-primary data-[state=active]:text-primary"
              >
                {t("runs")}
              </TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!runnable}
                onClick={() => setRunMode("simulation")}
              >
                <FlaskConical className="size-4" />
                {t("simulation")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!runnable}
                onClick={() => setRunMode("live")}
              >
                <Play className="size-4" />
                {t("live")}
              </Button>
            </div>
          </div>
          <TabsContent value="configure" className="mt-0">
            <div className="grid xl:grid-cols-[minmax(0,1fr)_350px]">
              <div className="min-w-0">
                <nav
                  aria-label={t("steps")}
                  className="flex flex-wrap gap-2 border-b bg-muted/20 p-3"
                >
                  {editor.definition.nodes.map((item, index) => (
                    <Button
                      key={item.id}
                      variant={selected === item.id ? "outline" : "ghost"}
                      size="sm"
                      aria-pressed={selected === item.id}
                      onClick={() => setSelected(item.id)}
                    >
                      <bdi>{fmt.number(index + 1)}</bdi>
                      <span className="max-w-36 truncate">{item.name}</span>
                      {index < editor.definition.nodes.length - 1 && (
                        <ChevronRight className="size-3" />
                      )}
                    </Button>
                  ))}
                  {editable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("addTask")}
                      disabled={editor.definition.nodes.length >= 100}
                      onClick={addTask}
                    >
                      <Plus className="size-4" />
                      {t("addTask")}
                    </Button>
                  )}
                </nav>
                <WorkflowCanvas
                  definition={editor.definition}
                  selected={selected}
                  onSelect={setSelected}
                />
              </div>
              <div className="border-t bg-card xl:border-s xl:border-t-0">
                {node === undefined ? (
                  <p className="p-6 text-sm text-muted-foreground">{t("configureHint")}</p>
                ) : (
                  <NodeInspector
                    key={node.id}
                    node={node}
                    editable={editable}
                    onChange={(changed) =>
                      editor.setDefinition({
                        ...editor.definition,
                        nodes: editor.definition.nodes.map((item) =>
                          item.id === changed.id ? changed : item,
                        ),
                      })
                    }
                    onRemove={() => {
                      editor.setDefinition(removeTask(editor.definition, node.id));
                      setSelected("read");
                    }}
                  />
                )}
              </div>
            </div>
            {editor.issues.length > 0 && (
              <div role="alert" className="border-t bg-destructive/5 p-5 text-sm text-destructive">
                <p className="font-medium">{t("issues", { count: editor.issues.length })}</p>
                <ul className="mt-2 list-inside list-disc">
                  {[
                    ...new Map(
                      editor.issues.map((issue) => [
                        `${issue.code}-${issue.nodeId ?? ""}-${issue.field ?? ""}`,
                        issue,
                      ]),
                    ).entries(),
                  ].map(([key, issue]) => (
                    <li key={key}>
                      <bdi>
                        {editor.definition.nodes.find((item) => item.id === issue.nodeId)?.name}
                      </bdi>{" "}
                      {t("issue")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>
          <TabsContent value="runs" className="mt-0">
            <RunHistory workflowId={initial.id} canCancel={initial.capabilities.cancel} />
          </TabsContent>
        </Tabs>
      </div>
      {runMode !== null && (
        <RunDialog
          workflowId={initial.id}
          mode={runMode}
          onClose={() => setRunMode(null)}
          onStarted={() => {
            void utils.workflows.runs.invalidate({ id: initial.id });
            setRunMode(null);
            editor.setNotice(t("queuedHint"));
            setTab("runs");
          }}
        />
      )}
    </div>
  );
}
