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
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { comparePublishedVersions, type VersionDifference } from "./publishedVersionDiff";
import { VersionComparison } from "./VersionComparison";

type Props = {
  workflowId: string;
  revision: number;
  canRestore: boolean;
  pending: boolean;
  error: string | null;
  onRestore: (versionNumber: number) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

export function VersionsDialog(props: Props) {
  return <VersionHistory key={props.workflowId} {...props} />;
}

function VersionHistory({
  workflowId,
  revision,
  canRestore,
  pending,
  error,
  onRestore,
  onClose,
  onCloseAutoFocus,
}: Props) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const versions = trpc.workflows.versions.useQuery(
    { id: workflowId },
    {
      staleTime: 0,
      refetchOnMount: "always",
      placeholderData: undefined,
    },
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [compared, setCompared] = useState<number | null>(null);
  const [selectionGeneration, setSelectionGeneration] = useState(0);
  const [retryGeneration, setRetryGeneration] = useState<number | null>(null);
  const retrying = retryGeneration === selectionGeneration;
  const version = trpc.workflows.version.useQuery(
    { id: workflowId, versionNumber: selected ?? 1 },
    {
      enabled: selected !== null,
      staleTime: 0,
      refetchOnMount: "always",
      placeholderData: undefined,
    },
  );
  const otherVersion = trpc.workflows.version.useQuery(
    { id: workflowId, versionNumber: compared ?? 1 },
    {
      enabled: compared !== null,
      staleTime: 0,
      refetchOnMount: "always",
      placeholderData: undefined,
    },
  );
  const selectedSummary = versions.data?.find((item) => item.number === selected);
  const comparedSummary = versions.data?.find((item) => item.number === compared);
  const currentData = version.data;
  const otherData = otherVersion.data;
  const listReady =
    !versions.isLoading && !versions.isFetching && !versions.isError && !versions.isPlaceholderData;
  const current =
    listReady &&
    selected !== null &&
    currentData !== undefined &&
    currentData.number === selected &&
    currentData.id === selectedSummary?.id &&
    !version.isLoading &&
    !version.isFetching &&
    !version.isError &&
    !version.isPlaceholderData
      ? currentData
      : null;
  const other =
    listReady &&
    compared !== null &&
    otherData !== undefined &&
    otherData.number === compared &&
    otherData.id === comparedSummary?.id &&
    !otherVersion.isLoading &&
    !otherVersion.isFetching &&
    !otherVersion.isError &&
    !otherVersion.isPlaceholderData
      ? otherData
      : null;
  const comparisonLoading =
    retrying ||
    versions.isLoading ||
    versions.isFetching ||
    versions.isPlaceholderData ||
    version.isLoading ||
    version.isFetching ||
    version.isPlaceholderData ||
    otherVersion.isLoading ||
    otherVersion.isFetching ||
    otherVersion.isPlaceholderData;
  let difference: VersionDifference | null = null;
  if (!comparisonLoading && current !== null && other !== null) {
    try {
      difference = comparePublishedVersions(other, current);
    } catch {
      /* Retained malformed data is reported without its contents. */
    }
  }
  async function retryComparison() {
    if (retrying || compared === null) return;
    const generation = selectionGeneration;
    setRetryGeneration(generation);
    try {
      await Promise.allSettled([
        Promise.resolve().then(() => versions.refetch()),
        Promise.resolve().then(() => version.refetch()),
        Promise.resolve().then(() => otherVersion.refetch()),
      ]);
    } finally {
      setRetryGeneration((active) => (active === generation ? null : active));
    }
  }
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
        <p className="text-sm text-muted-foreground">
          {t("savedRevision", { revision: String(revision) })}
        </p>
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
                variant={selected === item.number ? "default" : "outline"}
                className="h-auto w-full justify-between whitespace-normal text-start"
                disabled={pending}
                onClick={() => {
                  setSelected(item.number);
                  setCompared(null);
                  setSelectionGeneration((generation) => generation + 1);
                }}
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
            <Select
              ariaLabel={t("versionCompareSelector")}
              value={compared === null ? "" : String(compared)}
              options={[
                { value: "", label: t("versionCompareSingle") },
                ...(versions.data ?? []).map((item) => ({
                  value: String(item.number),
                  label: `${t("version", { number: item.number })} · ${item.name}`,
                })),
              ]}
              disabled={pending || versions.isFetching || versions.isError}
              onChange={(value) => {
                const choice = versions.data?.find((item) => String(item.number) === value);
                setCompared(choice?.number ?? null);
                setSelectionGeneration((generation) => generation + 1);
              }}
            />
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
                  {compared === null && (
                    <div className="min-h-[420px] overflow-hidden rounded-lg border">
                      <BuilderWorkspace
                        key={current.id}
                        definition={current.definition}
                        onChange={() => undefined}
                        editable={false}
                        issues={[]}
                      />
                    </div>
                  )}
                </>
              )
            )}
            {compared !== null && (
              <VersionComparison
                beforeNumber={compared}
                afterNumber={selected}
                phase={
                  comparisonLoading ? "loading" : difference === null ? "unavailable" : "ready"
                }
                difference={difference}
                retrying={comparisonLoading || pending}
                onRetry={() => void retryComparison()}
              />
            )}
            {current !== null && canRestore && (
              <Button
                disabled={
                  pending ||
                  version.isFetching ||
                  (compared !== null && (comparisonLoading || difference === null))
                }
                onClick={() => onRestore(current.number)}
              >
                {t("restoreAsDraft")}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
