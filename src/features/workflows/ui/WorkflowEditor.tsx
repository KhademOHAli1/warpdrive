"use client";

import { ArrowLeft, FlaskConical, Play, Save } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LanguageSwitcher, useAppTranslations } from "@/features/i18n/LocaleProvider";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import { trpc } from "@/lib/trpc-client";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { RunDialog } from "./RunDialog";
import { RunHistory } from "./RunHistory";
import { useDialogFocus } from "./useDialogFocus";
import { useWorkflowEditor, type WorkflowDetail } from "./useWorkflowEditor";

export function WorkflowEditor({ initial }: { initial: WorkflowDetail }) {
  const t = useAppTranslations("workflows");
  const utils = trpc.useUtils();
  const editor = useWorkflowEditor(initial);
  const [tab, setTab] = useState("configure");
  const [runMode, setRunMode] = useState<"simulation" | "live" | null>(null);
  const fieldId = useId();
  const runFocus = useDialogFocus();
  const runsTab = useRef<HTMLButtonElement>(null);
  const editable = initial.capabilities.edit && !editor.pending;
  const runnable = initial.capabilities.run && editor.active && !editor.pending;
  return (
    <div className="mx-auto flex max-w-[1700px] flex-col gap-4 xl:h-[calc(100dvh-120px)] xl:min-h-[620px]">
      <h1 className="sr-only">{editor.name}</h1>
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/workflows"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Badge variant="outline">{t("early")}</Badge>
        </div>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <label htmlFor={fieldId} className="sr-only">
            {t("name")}
          </label>
          <Input
            dir="auto"
            id={fieldId}
            value={editor.name}
            disabled={!editable}
            maxLength={120}
            className="h-11 max-w-xl border-transparent px-0 text-display font-semibold shadow-none focus-visible:px-3 md:text-display"
            onChange={(event) => editor.setName(event.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge variant={editor.active ? "success" : "secondary"}>
              {editor.active ? t("active") : editor.number === null ? t("draft") : t("paused")}
            </Badge>
            <span>
              {editor.number === null ? t("notPublished") : t("version", { number: editor.number })}
            </span>
            {editor.dirty && <span>{t("unsaved")}</span>}
            {editor.notice !== null && (
              <span role="status" className="text-success">
                {editor.notice}
              </span>
            )}
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
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
          <IdentityActionError message={editor.error} />
        </div>
      )}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm xl:min-h-0 xl:flex-1">
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex flex-col gap-0 xl:h-full xl:min-h-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
            <TabsList className="gap-5">
              <TabsTrigger
                value="configure"
                className="border-b-2 border-transparent py-2 data-[state=active]:border-primary data-[state=active]:text-primary"
              >
                {t("configure")}
              </TabsTrigger>
              <TabsTrigger
                ref={runsTab}
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
                onClick={(event) => {
                  runFocus.remember(event.currentTarget);
                  setRunMode("simulation");
                }}
              >
                <FlaskConical className="size-4" />
                {t("simulation")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!runnable}
                onClick={(event) => {
                  runFocus.remember(event.currentTarget);
                  setRunMode("live");
                }}
              >
                <Play className="size-4" />
                {t("live")}
              </Button>
            </div>
          </div>
          <TabsContent value="configure" className="mt-0 xl:min-h-0 xl:flex-1">
            <BuilderWorkspace
              definition={editor.definition}
              onChange={editor.setDefinition}
              editable={editable}
              issues={editor.issues}
              history={editor.history}
            />
          </TabsContent>
          <TabsContent value="runs" className="mt-0 xl:min-h-0 xl:flex-1 xl:overflow-auto">
            <RunHistory workflowId={initial.id} canCancel={initial.capabilities.cancel} />
          </TabsContent>
        </Tabs>
      </div>
      {runMode !== null && (
        <RunDialog
          workflowId={initial.id}
          mode={runMode}
          onCloseAutoFocus={(event) => runFocus.restore(event)}
          onClose={() => setRunMode(null)}
          onStarted={() => {
            runFocus.remember(runsTab.current);
            void utils.workflows.runs.invalidate({ id: initial.id });
            setRunMode(null);
            editor.setNotice("runStarted");
            setTab("runs");
          }}
        />
      )}
    </div>
  );
}
