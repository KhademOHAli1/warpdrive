"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { AssetsWorkspace } from "../../contracts";
import {
  type AssetRegisterDiscoveryAccess,
  type AssetRegisterSettings,
  type AssetRegisterView,
  type AssetRegisterViewsResult,
  maxAssetRegisterViewName,
} from "../contracts";
import { assetRegisterSettingsAvailable } from "../settings";
import { DiscoveryDialog } from "./DiscoveryDialog";
import type { DiscoveryWords } from "./messages";

type Status = Extract<AssetRegisterViewsResult, { ok: false }>["error"] | "transport" | "scopeLost";
type Edit =
  | { action: "save"; view: AssetRegisterView | null }
  | { action: "remove"; view: AssetRegisterView };
type Loaded = {
  access: AssetRegisterDiscoveryAccess;
  retryToken: number;
  result: AssetRegisterViewsResult | { ok: false; error: "transport" };
};

function ViewsDialog({
  editor,
  error,
  pending,
  close,
  restoreFocus,
  save,
  remove,
  words: t,
}: {
  editor: Edit;
  error: Status | null;
  pending: boolean;
  close: () => void;
  restoreFocus: () => void;
  save: (name: string) => void;
  remove: () => void;
  words: DiscoveryWords;
}) {
  const [name, setName] = useState(editor.view?.name ?? "");
  const removing = editor.action === "remove";
  const title = removing ? t.deleteView : editor.view === null ? t.saveView : t.updateView;
  return (
    <DiscoveryDialog
      kind="view"
      title={title}
      description={removing ? t.deleteDescription : t.viewDescription}
      cancelLabel={t.cancel}
      submitLabel={removing ? t.remove : t.save}
      pending={pending}
      disabled={!removing && name.trim() === ""}
      error={error === null ? null : t[error]}
      close={close}
      restoreFocus={restoreFocus}
      submit={removing ? remove : () => save(name.trim())}
    >
      {removing ? (
        <p>
          <bdi dir="auto">{editor.view.name}</bdi>
        </p>
      ) : (
        <SalesInput
          label={t.viewName}
          data-asset-view-name
          value={name}
          maxLength={maxAssetRegisterViewName}
          disabled={pending}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      )}
    </DiscoveryDialog>
  );
}

export function AssetRegisterViewsMenu({
  access,
  workspace,
  settings,
  activeView,
  onApply,
  onDefault,
  onActiveView,
  words: t,
}: {
  access: AssetRegisterDiscoveryAccess;
  workspace: AssetsWorkspace;
  settings: AssetRegisterSettings;
  activeView: string | null;
  onApply: (settings: AssetRegisterSettings, id: string) => void;
  onDefault: () => void;
  onActiveView: (id: string | null) => void;
  words: DiscoveryWords;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [dialog, setDialog] = useState<Edit | null>(null);
  const [error, setError] = useState<Status | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const flight = useRef(false);
  const retry = useRef<{ key: string; requestId: string } | null>(null);
  const load = loaded?.access === access && loaded.retryToken === retryToken ? loaded.result : null;
  const views = load?.ok === true ? load.views : [];
  const selected = views.find(({ id }) => id === activeView);
  const modified =
    selected !== undefined && JSON.stringify(selected.settings) !== JSON.stringify(settings);
  const savable = load?.ok === true && assetRegisterSettingsAvailable(workspace, settings);
  const readError = load?.ok === false ? load.error : null;
  const reload = () => {
    setRetryToken((value) => value + 1);
  };

  useEffect(() => {
    let relevant = true;
    const accept = (result: Loaded["result"]) => {
      if (relevant) setLoaded({ access, retryToken, result });
    };
    void access.readViews().then(accept, () => accept({ ok: false, error: "transport" }));
    return () => {
      relevant = false;
    };
  }, [access, retryToken]);

  function apply(view: AssetRegisterView) {
    setSaved(false);
    if (!assetRegisterSettingsAvailable(workspace, view.settings)) {
      setError("scopeLost");
      return;
    }
    setError(null);
    onApply(view.settings, view.id);
  }

  function open(editor: Edit) {
    setError(null);
    setSaved(false);
    setDialog(editor);
  }

  async function commit(name: string) {
    if (dialog === null || flight.current) return;
    if (dialog.action === "save" && !savable) {
      setError("scopeLost");
      return;
    }
    const key = JSON.stringify([
      dialog.action,
      dialog.view?.id,
      dialog.view?.version,
      name,
      settings,
    ]);
    const requestId = retry.current?.key === key ? retry.current.requestId : crypto.randomUUID();
    flight.current = true;
    retry.current = { key, requestId };
    setPending(true);
    setError(null);
    try {
      const response =
        dialog.action === "remove"
          ? await access.removeView({ id: dialog.view.id, version: dialog.view.version, requestId })
          : await access.saveView({
              id: dialog.view?.id ?? null,
              version: dialog.view?.version ?? null,
              name,
              settings,
              requestId,
            });
      retry.current = null;
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setLoaded({ access, retryToken, result: response });
      const updated = response.views.find((view) =>
        dialog.view === null ? view.name === name : view.id === dialog.view.id,
      );
      onActiveView(dialog.action === "remove" ? null : (updated?.id ?? null));
      setSaved(true);
      setDialog(null);
    } catch {
      setError("transport");
    } finally {
      flight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="min-w-0 space-y-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            size="sm"
            variant="outline"
            aria-label={t.views}
            data-asset-view-menu
          >
            <bdi dir="auto" className="max-w-40 truncate">
              {selected?.name ?? t.views}
            </bdi>
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className={`${BLOCK_CLASS} ph-no-capture max-h-[min(65vh,24rem)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto`}
        >
          <DropdownMenuItem
            onSelect={() => {
              setError(null);
              setSaved(false);
              onDefault();
            }}
            aria-current={activeView === null ? "true" : undefined}
          >
            {t.defaultView}
          </DropdownMenuItem>
          {load === null && <DropdownMenuItem disabled>{t.loading}</DropdownMenuItem>}
          {readError !== null && (
            <DropdownMenuItem onSelect={reload}>{t.reloadViews}</DropdownMenuItem>
          )}
          {views.map((view) => (
            <DropdownMenuItem
              key={view.id}
              data-asset-view={view.id}
              aria-current={view.id === activeView ? "true" : undefined}
              onSelect={() => apply(view)}
            >
              <bdi dir="auto" className="min-w-0 truncate">
                {view.name}
              </bdi>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!savable}
            onSelect={() => open({ action: "save", view: null })}
          >
            {t.saveView}
          </DropdownMenuItem>
          {selected !== undefined && (
            <>
              <DropdownMenuItem
                disabled={!savable}
                onSelect={() => open({ action: "save", view: selected })}
              >
                {t.updateView}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => open({ action: "remove", view: selected })}>
                {t.deleteView}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {modified && (
        <Badge variant="outline" className="ms-1">
          {t.modified}
        </Badge>
      )}
      {saved && (
        <span role="status" className="sr-only">
          {t.viewsSaved}
        </span>
      )}
      {dialog === null && (error ?? readError) !== null && (
        <p role="alert" className="text-xs text-destructive">
          {t[(error ?? readError) as Status]}
        </p>
      )}
      {dialog !== null && (
        <ViewsDialog
          editor={dialog}
          error={error}
          pending={pending}
          close={() => setDialog(null)}
          restoreFocus={() => trigger.current?.focus()}
          save={(name) => void commit(name)}
          remove={() => void commit("")}
          words={t}
        />
      )}
    </div>
  );
}
