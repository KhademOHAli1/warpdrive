"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { BuilderWorkspace } from "./BuilderWorkspace";

export function VersionsDialog({
  workflowId,
  revision,
  canRestore,
  pending,
  error,
  onRestore,
  onClose,
  onCloseAutoFocus,
}: {
  workflowId: string;
  revision: number;
  canRestore: boolean;
  pending: boolean;
  error: string | null;
  onRestore: (versionNumber: number) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const versions = trpc.workflows.versions.useQuery({ id: workflowId });
  const [selected, setSelected] = useState<number | null>(null);
  const version = trpc.workflows.version.useQuery(
    { id: workflowId, versionNumber: selected ?? 1 },
    { enabled: selected !== null },
  );
  const current = selected !== null && version.data?.number === selected ? version.data : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="max-h-[90dvh] max-w-6xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("versions")}</DialogTitle>
          <DialogDescription>{t("versionsHint")}</DialogDescription>
        </DialogHeader>
        {error !== null && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <p className="text-sm text-muted-foreground">{t("savedRevision", { revision })}</p>
        {versions.isLoading && <p role="status">{t("loading")}</p>}
        {versions.isError ? (
          <div>
            <p role="alert">{t("loadError")}</p>
            <Button
              variant="outline"
              onClick={() => void versions.refetch()}
              disabled={versions.isFetching}
            >
              {t("retry")}
            </Button>
          </div>
        ) : (
          <fieldset className="space-y-2">
            <legend className="sr-only">{t("versionSelection")}</legend>
            {versions.data?.map((item) => (
              <Button
                key={item.id}
                variant={selected === item.number ? "secondary" : "outline"}
                className="h-auto w-full justify-between whitespace-normal text-start"
                disabled={pending}
                onClick={() => setSelected(item.number)}
              >
                <bdi>{item.name}</bdi>
                <span>
                  {t("version", { number: item.number })} · {fmt.dateTime(item.createdAt)}
                </span>
              </Button>
            ))}
            {!versions.isLoading && versions.data?.length === 0 && <p>{t("versionsEmpty")}</p>}
          </fieldset>
        )}
        {selected !== null && (
          <div className="space-y-3 border-t pt-4">
            {version.isLoading && <p role="status">{t("loading")}</p>}
            {version.isError ? (
              <div>
                <p role="alert">{t("loadError")}</p>
                <Button variant="outline" onClick={() => void version.refetch()}>
                  {t("retry")}
                </Button>
              </div>
            ) : (
              current !== null && (
                <>
                  <h3 className="font-semibold">
                    <bdi>{current.name}</bdi>
                  </h3>
                  <p className="text-sm text-muted-foreground">{t("restoreHint")}</p>
                  <div className="min-h-[420px] overflow-hidden rounded-lg border">
                    <BuilderWorkspace
                      key={current.id}
                      definition={current.definition}
                      onChange={() => undefined}
                      editable={false}
                      issues={[]}
                    />
                  </div>
                  {canRestore && (
                    <Button
                      disabled={pending || version.isFetching}
                      onClick={() => onRestore(current.number)}
                    >
                      {t("restoreAsDraft")}
                    </Button>
                  )}
                </>
              )
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
