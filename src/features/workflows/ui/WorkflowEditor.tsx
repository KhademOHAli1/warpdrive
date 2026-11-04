"use client";

import { ArrowLeft, FlaskConical, Play, Save } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LanguageSwitcher, useAppTranslations } from "@/features/i18n/LocaleProvider";
import { IdentityActionError } from "@/features/identity/IdentityActionError";
import { trpc } from "@/lib/trpc-client";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { EditorDuplicateDialog } from "./EditorDuplicateDialog";
import { type EditorLifecycleRequest, EditorLifecycleReview } from "./EditorLifecycleReview";
import { EditorRecovery } from "./EditorRecovery";
import { sanitizeLibraryReturnTo } from "./libraryLocation";
import { RunDialog } from "./RunDialog";
import { RunHistory } from "./RunHistory";
import { useDialogFocus } from "./useDialogFocus";
import { useWorkflowEditor, type WorkflowDetail } from "./useWorkflowEditor";
import { useWorkflowLifecycle } from "./useWorkflowLifecycle";
import { VersionsDialog } from "./VersionsDialog";

function editorStatus(
  editor: Pick<ReturnType<typeof useWorkflowEditor>, "archivedAt" | "active" | "number">,
) {
  if (editor.archivedAt !== null) return "archived";
  if (editor.number === null) return "draft";
  return editor.active ? "active" : "paused";
}

export function WorkflowEditor({
  initial,
  returnTo = "/workflows",
  initialHistory = false,
}: {
  initial: WorkflowDetail;
  returnTo?: string;
  initialHistory?: boolean;
}) {
  const t = useAppTranslations("workflows");
  const utils = trpc.useUtils();
  const editor = useWorkflowEditor(initial);
  const libraryReturn = sanitizeLibraryReturnTo(returnTo);
  const lifecycle = useWorkflowLifecycle(initial.id, editor, libraryReturn);
  const [versionsOpen, setVersionsOpen] = useState(initialHistory);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [copyName, setCopyName] = useState(() =>
    t("duplicateDefaultName", { name: initial.name }).slice(0, 120),
  );
  const confirming = useRef(false);
  const [confirmation, setConfirmation] = useState<EditorLifecycleRequest | null>(null);
  const lifecycleFocus = useDialogFocus();
  const heading = useRef<HTMLHeadingElement>(null);
  const lifecycleError = lifecycle.error === null ? null : t(lifecycle.error);
  function author(operation: "save" | "publish" | "pause") {
    lifecycle.dismissAck();
    void editor.perform(operation);
  }
  const [tab, setTab] = useState("configure");
  const [runMode, setRunMode] = useState<"simulation" | "live" | null>(null);
  const fieldId = useId();
  const runFocus = useDialogFocus();
  const runsTab = useRef<HTMLButtonElement>(null);
  const editable = editor.archivedAt === null && editor.capabilities.edit && !editor.pending;
  const runnable =
    editor.archivedAt === null && editor.capabilities.run && editor.active && !editor.pending;
  const recovery = <EditorRecovery lifecycle={lifecycle} libraryReturn={libraryReturn} />;
  return (
    <div className="mx-auto flex max-w-[1700px] flex-col gap-4 xl:h-[calc(100dvh-120px)] xl:min-h-[620px]">
      <h1 ref={heading} tabIndex={-1} className="sr-only">
        {editor.name}
      </h1>
      <div className="flex items-center justify-between gap-4">
        <Link
          href={libraryReturn}
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
              {t(editorStatus(editor))}
            </Badge>
            <span>
              {editor.number === null ? t("notPublished") : t("version", { number: editor.number })}
            </span>
            {editor.dirty && <span>{t("unsaved")}</span>}
            {(lifecycle.acknowledged !== null || editor.notice !== null) && (
              <span role="status" className="text-success">
                {lifecycle.acknowledged !== null ? t(lifecycle.acknowledged) : editor.notice}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editor.available && (
            <Button
              variant="outline"
              disabled={editor.pending}
              onClick={(event) => {
                lifecycleFocus.remember(event.currentTarget);
                setVersionsOpen(true);
              }}
            >
              {t("versions")}
            </Button>
          )}
          {editor.capabilities.duplicate && (
            <Button
              variant="outline"
              disabled={editor.pending || lifecycle.unknown || lifecycle.copyId !== null}
              onClick={(event) => {
                lifecycleFocus.remember(event.currentTarget);
                lifecycle.clearError();
                setDuplicateOpen(true);
              }}
            >
              {t("duplicate")}
            </Button>
          )}
          {(editor.archivedAt === null
            ? editor.capabilities.edit
            : editor.capabilities.unarchive) && (
            <Button
              variant="outline"
              disabled={editor.pending || lifecycle.unknown}
              onClick={(event) => {
                lifecycleFocus.remember(event.currentTarget);
                lifecycle.clearError();
                setConfirmation({
                  operation: editor.archivedAt === null ? "archive" : "unarchive",
                });
              }}
            >
              {t(editor.archivedAt === null ? "archive" : "unarchive")}
            </Button>
          )}
          {editor.capabilities.edit && (
            <Button
              variant="outline"
              disabled={editor.pending || !editor.dirty}
              onClick={() => author("save")}
            >
              <Save className="size-4" />
              {t("save")}
            </Button>
          )}
          {editor.capabilities.publish && (
            <Button
              disabled={editor.pending || editor.issues.length > 0 || editor.name.trim() === ""}
              onClick={() => author("publish")}
            >
              {t("publish")}
            </Button>
          )}
          {editor.active && editor.capabilities.edit && (
            <Button
              variant="outline"
              title={t("pauseHint")}
              disabled={editor.pending}
              onClick={() => author("pause")}
            >
              {t("pause")}
            </Button>
          )}
        </div>
      </header>
      {editor.archivedAt !== null && (
        <p className="rounded-lg border bg-muted/30 p-4 text-sm">{t("archivedHint")}</p>
      )}
      {lifecycleError !== null && !versionsOpen && !duplicateOpen && (
        <p role="alert" className="text-destructive">
          {lifecycleError}
        </p>
      )}
      {!duplicateOpen && recovery}
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
                disabled={!editor.available}
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
              workflowId={initial.id}
              definition={editor.definition}
              onChange={editor.setDefinition}
              editable={editable}
              issues={editor.issues}
              history={editor.history}
            />
          </TabsContent>
          <TabsContent value="runs" className="mt-0 xl:min-h-0 xl:flex-1 xl:overflow-auto">
            {editor.available && (
              <RunHistory workflowId={initial.id} canCancel={editor.capabilities.cancel} />
            )}
          </TabsContent>
        </Tabs>
      </div>
      {versionsOpen && (
        <VersionsDialog
          workflowId={initial.id}
          revision={editor.revision}
          canRestore={
            editor.capabilities.restore && editor.archivedAt === null && !lifecycle.unknown
          }
          pending={editor.pending}
          error={lifecycleError}
          onClose={() => setVersionsOpen(false)}
          onCloseAutoFocus={(event) => lifecycleFocus.restore(event, heading.current)}
          onRestore={(versionNumber) => setConfirmation({ operation: "restore", versionNumber })}
        />
      )}
      {duplicateOpen && (
        <EditorDuplicateDialog
          name={copyName}
          onNameChange={setCopyName}
          recovery={recovery}
          pending={editor.pending}
          blocked={lifecycle.unknown || lifecycle.copyId !== null}
          error={lifecycleError}
          onClose={() => setDuplicateOpen(false)}
          onCloseAutoFocus={(event) => lifecycleFocus.restore(event, heading.current)}
          onSubmit={(name) =>
            editor.requestDeparture(() => {
              void lifecycle.duplicate(name).then((committed) => {
                if (committed) setDuplicateOpen(false);
              });
            })
          }
        />
      )}
      <EditorLifecycleReview
        request={confirmation}
        revision={editor.revision}
        dirty={editor.dirty}
        pending={editor.pending}
        onCloseAutoFocus={(event) => lifecycleFocus.restore(event, heading.current)}
        onOpenChange={(open) => {
          if (!open && !editor.pending && !confirming.current) setConfirmation(null);
        }}
        onConfirm={() => {
          const request = confirmation;
          if (request === null || confirming.current) return;
          confirming.current = true;
          void lifecycle
            .change(request.operation, request.versionNumber)
            .then((committed) => {
              if (committed && request.operation === "restore") setVersionsOpen(false);
            })
            .finally(() => {
              confirming.current = false;
              setConfirmation(null);
            });
        }}
      />
      <ConfirmDialog
        open={editor.leaveRequest !== null}
        onOpenChange={(open) => {
          if (!open) editor.cancelLeave();
        }}
        title={t("leaveTitle")}
        description={t(editor.pending ? "leavePending" : "leaveUnsaved")}
        confirmLabel={t("leaveConfirm")}
        cancelLabel={t("leaveCancel")}
        onConfirm={editor.confirmLeave}
      />
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
