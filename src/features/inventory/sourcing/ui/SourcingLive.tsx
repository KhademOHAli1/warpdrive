"use client";

import { RefreshCw } from "lucide-react";
import { type MouseEvent, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type { SourcingError, SourcingIntent, SourcingQuery, SourcingResult } from "../contracts";
import { executeSourcingAction } from "./actions";
import { type SourcingMessages, sourcingMessages } from "./messages";
import { SourcingEditor } from "./SourcingEditors";
import { SourcingView } from "./SourcingView";
import type { DialogProps, Editor, Workspace } from "./types";

type OpenEditor = (event: MouseEvent<HTMLButtonElement>, next: Editor) => void;

function SourcingScopePicker({
  workspace,
  busy,
  select,
  t,
}: {
  workspace: Workspace;
  busy: boolean;
  select: (next: SourcingQuery) => void;
  t: SourcingMessages;
}) {
  if (workspace.sites.length === 0) return null;
  return (
    <div className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:max-w-xl sm:grid-cols-2">
      <CatalogField label={t.site}>
        <CatalogSelect
          ariaLabel={t.site}
          value={workspace.selectedSiteId ?? ""}
          onChange={(siteId) => select({ siteId })}
          options={workspace.sites.map(({ id, name, code, archived }) => ({
            value: id,
            label: `${name} · ${code}${archived ? ` (${t.archived})` : ""}`,
          }))}
          disabled={busy}
        />
      </CatalogField>
      <CatalogField label={t.part}>
        <CatalogSelect
          ariaLabel={t.part}
          value={workspace.selectedItemId ?? ""}
          onChange={(itemId) => select({ siteId: workspace.selectedSiteId ?? undefined, itemId })}
          options={workspace.parts.map(({ id, name, code, revision }) => ({
            value: id,
            label: `${code} · ${revision} — ${name}`,
          }))}
          disabled={busy || workspace.parts.length === 0}
        />
      </CatalogField>
    </div>
  );
}

function SourcingWorkspaceContent({
  workspace,
  busy,
  editor,
  dialog,
  open,
  t,
}: {
  workspace: Workspace;
  busy: boolean;
  editor: Editor | null;
  dialog: DialogProps;
  open: OpenEditor;
  t: SourcingMessages;
}) {
  const site = workspace.sites.find(({ id }) => id === workspace.selectedSiteId);
  const part = workspace.parts.find(({ id }) => id === workspace.selectedItemId);
  if (site === undefined || part === undefined) {
    return (
      <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {site === undefined ? t.noSites : t.noParts}
      </p>
    );
  }

  const active = !site.archived && part.canSource;
  const canOpenEditor =
    editor !== null &&
    active &&
    (editor.type === "manufacturer" || editor.type === "offer"
      ? site.canBuy
      : site.canEditCosts && workspace.pricing !== undefined);
  return (
    <>
      <SourcingView key={`${site.id}:${part.id}`} {...{ workspace, busy, open, t }} />
      {canOpenEditor && (
        <SourcingEditor
          {...{ editor, workspace, dialog }}
          context={{ siteId: site.id, itemId: part.id }}
        />
      )}
    </>
  );
}

export function SourcingLive({ actorId, initial }: { actorId: string; initial: SourcingResult }) {
  const t = sourcingMessages[useLocale()];
  const [scope, setScope] = useState<SourcingQuery | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<SourcingError | "transport" | null>(null);
  const active = useRef(false);
  const attempted = useRef<{ intent: string; requestId: string } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const actions = useRef<HTMLDivElement | null>(null);
  const utils = trpc.useUtils();
  const query = trpc.inventory.sourcing.workspace.useQuery(scope ?? {}, {
    initialData: scope === null ? initial : undefined,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: "always",
  });
  const workspace = !query.isError && query.data?.ok === true ? query.data.value : null;
  const busy = query.isFetching || pending;

  function select(next: SourcingQuery) {
    setScope(next);
    setEditor(null);
    setSaved(false);
  }

  function open(event: MouseEvent<HTMLButtonElement>, next: Editor) {
    trigger.current = event.currentTarget;
    setError(null);
    setSaved(false);
    setEditor(next);
  }

  async function save(intent: SourcingIntent) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    const serialized = JSON.stringify(intent);
    const requestId =
      attempted.current?.intent === serialized ? attempted.current.requestId : crypto.randomUUID();
    attempted.current = { intent: serialized, requestId };
    try {
      const result = await executeSourcingAction(
        actorId,
        { ...intent, requestId },
        readCsrfToken(),
      );
      attempted.current = null;
      if (!result.ok) {
        setError(result.error);
        if (result.error === "unavailable" || result.error === "stale") {
          void utils.inventory.sourcing.workspace.invalidate(scope ?? {});
        }
        return;
      }
      setEditor(null);
      setSaved(true);
      void utils.inventory.sourcing.workspace.invalidate();
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  const dialog: DialogProps = {
    pending,
    error: error === null ? null : t[error],
    close: () => setEditor(null),
    restoreFocus: () => {
      if (trigger.current?.isConnected === true) trigger.current.focus();
      else actions.current?.focus();
    },
    save: (intent) => {
      void save(intent);
    },
  };
  const loadError = query.data?.ok === false ? t[query.data.error] : t.unavailable;
  return (
    <main className={`${BLOCK_CLASS} ph-no-capture min-w-0 pb-4`} aria-busy={busy}>
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        actions={
          <div ref={actions} tabIndex={-1}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void query.refetch();
              }}
            >
              <RefreshCw aria-hidden="true" />
              {t.refresh}
            </Button>
          </div>
        }
      />
      {workspace === null ? (
        query.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t.loading}
          </p>
        ) : (
          <p role="alert" className="rounded-lg border bg-card p-4 text-sm text-destructive">
            {loadError}
          </p>
        )
      ) : (
        <>
          <SourcingScopePicker {...{ workspace, busy, select, t }} />
          {saved && (
            <p role="status" className="mb-3 text-sm text-muted-foreground">
              {t.saved}
            </p>
          )}
          <SourcingWorkspaceContent {...{ workspace, busy, editor, dialog, open, t }} />
        </>
      )}
    </main>
  );
}
