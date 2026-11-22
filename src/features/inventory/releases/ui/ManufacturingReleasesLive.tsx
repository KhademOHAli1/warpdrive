"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import { readCsrfToken } from "@/utils/csrfCookie";
import { bomHref } from "../../bom/ui/links";
import { bomMessages } from "../../bom/ui/messages";
import type { InventoryItem } from "../../contracts";
import { type ManualReleaseArtifactKind, releaseFixtureMaxFileBytes } from "../contracts";
import { NativeExportIntake } from "../intake/ui/NativeExportIntake";
import type {
  ReleaseCommand,
  ReleaseCommandResult,
  ReleaseView,
  ReleaseWorkspace,
} from "../liveContracts";
import { uploadReleaseFile } from "../uploadReleaseFile";
import { executeManufacturingReleaseAction, readManufacturingReleasesAction } from "../webActions";
import { ManufacturingReleasePermissions } from "./ManufacturingReleasePermissions";
import { manufacturingReleaseLiveMessages } from "./manufacturingReleaseLiveMessages";
import { manufacturingReleaseMessages } from "./manufacturingReleaseMessages";
import { qualityPlanMessages } from "./qualityPlanMessages";
import {
  ApproveManufacturingRelease,
  NewManufacturingDraft,
  UploadReleaseArtifact,
} from "./ReleaseDraftControls";
import {
  ReleaseApprovalHistory,
  ReleaseArtifacts,
  ReleaseBom,
  ReleasePackageHeading,
} from "./ReleasePackageContent";
import { ReleaseQualityPlan } from "./ReleaseQualityPlan";

type Upload = { type: "upload"; releaseId: string; kind: ManualReleaseArtifactKind; file: File };
type EditorCommand = ReleaseCommand | Upload;
type SavedReleaseCommand = Extract<ReleaseCommandResult, { ok: true }>["value"];
type RunRelease = (command: EditorCommand, notice: string) => Promise<SavedReleaseCommand | null>;

async function executeReleaseOperation(
  command: EditorCommand,
  errors: { emptyFile: string; fileTooLarge: string; uploadFailed: string },
): Promise<ReleaseCommandResult> {
  if (command.type !== "upload") {
    return executeManufacturingReleaseAction(command, readCsrfToken());
  }
  const { file, kind, releaseId } = command;
  if (file.size === 0) return { ok: false, error: errors.emptyFile };
  if (file.size > releaseFixtureMaxFileBytes) return { ok: false, error: errors.fileTooLarge };
  const issued = await executeManufacturingReleaseAction(
    { type: "requestUpload", releaseId, kind, name: file.name, sizeBytes: file.size },
    readCsrfToken(),
  );
  if (!issued.ok) return issued;
  const { post, artifactId } = issued.value;
  if (post === undefined || artifactId === undefined)
    return { ok: false, error: errors.uploadFailed };
  if (!(await uploadReleaseFile(post, file))) return { ok: false, error: errors.uploadFailed };
  return executeManufacturingReleaseAction(
    { type: "confirmUpload", releaseId, artifactId },
    readCsrfToken(),
  );
}

export function ManufacturingReleasesLive({ item }: { item: InventoryItem }) {
  const t = manufacturingReleaseLiveMessages[useLocale()];
  const query = useQuery({
    queryKey: ["inventory", "manufacturingReleases", item.id],
    queryFn: () => readManufacturingReleasesAction(item.id),
    gcTime: 0,
    retry: false,
  });
  if (query.isPending)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        {t.loading}
      </p>
    );
  if (query.isError || !query.data.ok) {
    return (
      <div className="space-y-2 p-4">
        <p role="alert" className="text-sm text-muted-foreground">
          {t.unavailable}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t.retry}
        </Button>
      </div>
    );
  }
  return (
    <ManufacturingReleaseWorkspace
      key={item.id}
      workspace={query.data.value}
      refresh={query.refetch}
    />
  );
}

function ManufacturingReleaseWorkspace({
  workspace,
  refresh,
}: {
  workspace: ReleaseWorkspace;
  refresh: () => Promise<unknown>;
}) {
  const locale = useLocale();
  const t = manufacturingReleaseMessages[locale];
  const live = manufacturingReleaseLiveMessages[locale];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const inFlight = useRef(false);
  const headingId = useId();
  const active = workspace.releases.find(({ id }) => id === workspace.activeReleaseId);
  const selected =
    workspace.releases.find(({ id }) => id === selectedId) ?? active ?? workspace.releases[0];
  const mutation = useMutation({
    mutationFn: (command: EditorCommand) =>
      executeReleaseOperation(command, { ...t.errors, uploadFailed: live.uploadFailed }),
    onSettled: async () => {
      await refresh();
    },
  });

  const run: RunRelease = async (command, notice) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setFeedback(null);
    try {
      const result = await mutation.mutateAsync(command);
      setFeedback({ ok: result.ok, message: result.ok ? notice : result.error });
      return result.ok ? result.value : null;
    } catch {
      setFeedback({
        ok: false,
        message: command.type === "upload" ? live.uploadFailed : live.operationFailed,
      });
      return null;
    } finally {
      inFlight.current = false;
    }
  };
  const pending = mutation.isPending;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(BLOCK_CLASS, "ph-no-capture min-w-0 space-y-4 p-4")}
    >
      <h3 id={headingId} className="text-sm font-semibold">
        {t.heading}
      </h3>
      <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
        <h4 className="text-xs font-medium text-muted-foreground">{t.activeRelease}</h4>
        {active === undefined ? (
          <p className="text-sm">{t.noActiveRelease}</p>
        ) : (
          <bdi className="break-all text-sm font-semibold">
            {t.shortRevision} {active.revision}
          </bdi>
        )}
      </div>
      {feedback !== null && (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={cn("text-sm", feedback.ok ? "text-success" : "text-destructive")}
        >
          {feedback.message}
        </p>
      )}
      <LiveReleaseHistory
        releases={workspace.releases}
        selectedId={selected?.id}
        select={(id) => {
          setSelectedId(id);
          setFeedback(null);
        }}
        pending={pending}
      />
      {workspace.canEdit && (
        <NewManufacturingDraft
          pending={pending}
          create={async (revision) => {
            const result = await run(
              { type: "createDraft", itemId: workspace.itemId, revision },
              t.notices.createDraft,
            );
            if (result?.releaseId !== undefined) setSelectedId(result.releaseId);
            return result !== null;
          }}
        />
      )}
      {selected !== undefined && (
        <LiveReleasePackage
          key={selected.id}
          release={selected}
          itemId={workspace.itemId}
          sku={workspace.sku}
          intakeAvailable={workspace.intakeAvailable === true}
          refresh={refresh}
          qualityPlanVersions={workspace.qualityPlanVersions}
          canEdit={workspace.canEdit}
          canApprove={workspace.canApprove}
          pending={pending}
          run={run}
        />
      )}
      {workspace.canManage && (
        <ManufacturingReleasePermissions
          workspace={workspace}
          pending={pending}
          setRequirement={(required) =>
            void run(
              { type: "setRequirement", itemId: workspace.itemId, required },
              live.requirementSaved,
            )
          }
          setGrant={async (userId, role) =>
            (await run(
              { type: "setGrant", itemId: workspace.itemId, userId, role },
              live.permissionSaved,
            )) !== null
          }
        />
      )}
    </section>
  );
}

function LiveReleaseHistory({
  releases,
  selectedId,
  select,
  pending,
}: {
  releases: ReleaseView[];
  selectedId?: string;
  select: (id: string) => void;
  pending: boolean;
}) {
  const t = manufacturingReleaseMessages[useLocale()];
  const id = useId();
  return (
    <section className="space-y-2 border-t pt-3" aria-labelledby={id}>
      <h4 id={id} className="text-sm font-semibold">
        {t.history}
      </h4>
      {releases.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noReleases}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {releases.map((release) => (
            <li key={release.id} className="min-w-0">
              <Button
                variant={release.id === selectedId ? "default" : "outline"}
                size="sm"
                aria-label={`${t.shortRevision} ${release.revision}`}
                aria-pressed={release.id === selectedId}
                onClick={() => select(release.id)}
                className="max-w-full whitespace-normal break-all"
                disabled={pending}
              >
                <bdi>
                  {t.shortRevision} {release.revision}
                </bdi>
                {release.status === "draft" && <Badge variant="secondary">{t.draft}</Badge>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveReleasePackage({
  release,
  itemId,
  sku,
  intakeAvailable,
  refresh,
  qualityPlanVersions,
  canEdit,
  canApprove,
  pending,
  run,
}: {
  release: ReleaseView;
  itemId: string;
  sku: string;
  intakeAvailable: boolean;
  refresh: () => Promise<unknown>;
  qualityPlanVersions: ReleaseWorkspace["qualityPlanVersions"];
  canEdit: boolean;
  canApprove: boolean;
  pending: boolean;
  run: RunRelease;
}) {
  const locale = useLocale();
  const t = manufacturingReleaseMessages[locale];
  const quality = qualityPlanMessages[locale];
  const draft = release.status === "draft";
  const mutable = draft && canEdit;
  const pinnedQualityPlan = qualityPlanVersions?.find(
    ({ id }) => id === release.qualityPlanVersionId,
  );
  return (
    <section className="space-y-3 border-t pt-3">
      <ReleasePackageHeading release={release} />
      <ReleaseArtifacts
        release={release}
        pending={pending}
        remove={
          mutable
            ? (artifactId) =>
                void run(
                  { type: "removeArtifact", releaseId: release.id, artifactId },
                  t.notices.removeArtifact,
                )
            : undefined
        }
      />
      {mutable && (
        <UploadReleaseArtifact
          pending={pending}
          upload={async (kind, file) =>
            (await run(
              { type: "upload", releaseId: release.id, kind, file },
              t.notices.addArtifact,
            )) !== null
          }
        />
      )}
      {intakeAvailable && (
        <NativeExportIntake
          target={{ itemId, releaseId: release.id, sku, revision: release.revision }}
          canEdit={mutable}
          onReady={(job) => {
            const visibleIds = new Set(
              [...release.artifacts, ...(release.pcbSourceArtifacts ?? [])].map(({ id }) => id),
            );
            if (job.artifacts.some(({ id }) => !visibleIds.has(id))) void refresh();
          }}
        />
      )}
      {qualityPlanVersions !== undefined && (
        <ReleaseQualityPlan
          pinned={pinnedQualityPlan}
          pinnedId={release.qualityPlanVersionId ?? null}
          versions={qualityPlanVersions}
          pending={pending}
          edit={
            mutable
              ? {
                  select: (planVersionId) => {
                    if (planVersionId === (release.qualityPlanVersionId ?? null)) return;
                    void run(
                      { type: "setQualityPlan", releaseId: release.id, planVersionId },
                      quality.saved,
                    );
                  },
                  create: async (name, steps, requestId) =>
                    (await run(
                      { type: "createQualityPlanVersion", itemId, requestId, name, steps },
                      quality.created,
                    )) !== null,
                }
              : undefined
          }
        />
      )}
      {draft && (
        <ApproveManufacturingRelease
          release={release}
          pinnedQualityPlan={pinnedQualityPlan}
          pending={pending}
          canApprove={canApprove}
          approve={async () =>
            (await run(
              {
                type: "approve",
                releaseId: release.id,
                ...(release.qualityPlanVersionId === undefined
                  ? {}
                  : { expectedQualityPlanVersionId: release.qualityPlanVersionId }),
              },
              t.notices.approve,
            )) !== null
          }
        />
      )}
      {release.hasPlanningBom !== true && <ReleaseBom bom={release.bom} />}
      {!draft && (
        <Link
          href={bomHref({ releaseId: release.id })}
          prefetch={false}
          className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {bomMessages[locale].title}
        </Link>
      )}
      <ReleaseApprovalHistory release={release} />
    </section>
  );
}
