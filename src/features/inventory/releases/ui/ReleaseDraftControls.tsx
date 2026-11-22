"use client";

import { FilePlus } from "lucide-react";
import { useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { BomCsvGuide } from "../../bom/ui/BomCsvGuide";
import type { QualityPlanVersion } from "../../quality/contracts";
import { type ManualReleaseArtifactKind, releaseArtifactKinds } from "../contracts";
import type { ReleaseView } from "../liveContracts";
import { manufacturingReleaseLiveMessages } from "./manufacturingReleaseLiveMessages";
import { manufacturingReleaseMessages } from "./manufacturingReleaseMessages";
import { qualityPlanMessages } from "./qualityPlanMessages";

export function NewManufacturingDraft({
  pending,
  create,
}: {
  pending: boolean;
  create: (revision: string) => Promise<boolean>;
}) {
  const t = manufacturingReleaseMessages[useLocale()];
  const id = useId();
  const [revision, setRevision] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void create(revision).then((saved) => {
          if (saved) setRevision("");
        });
      }}
    >
      <label htmlFor={id} className="grid min-w-20 flex-1 gap-1 text-xs font-medium">
        {t.revision}
        <Input
          id={id}
          value={revision}
          onChange={(event) => setRevision(event.target.value)}
          maxLength={20}
          required
          disabled={pending}
        />
      </label>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending || revision.trim() === ""}
      >
        {t.createDraft}
      </Button>
    </form>
  );
}

const fileAccept: Partial<Record<ManualReleaseArtifactKind, string>> = {
  pcbFabrication: ".zip",
  manufacturingBom: ".csv",
};

export function UploadReleaseArtifact({
  pending,
  upload,
}: {
  pending: boolean;
  upload: (kind: ManualReleaseArtifactKind, file: File) => Promise<boolean>;
}) {
  const t = manufacturingReleaseMessages[useLocale()];
  const inputId = useId();
  const [kind, setKind] = useState<ManualReleaseArtifactKind>("pcbFabrication");

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("releaseArtifact");
        if (!(input instanceof HTMLInputElement)) return;
        const file = input.files?.[0];
        if (file === undefined) return;
        void upload(kind, file).then((saved) => {
          if (saved) input.value = "";
        });
      }}
    >
      <div className="grid gap-1">
        <span className="text-xs font-medium">{t.fileRole}</span>
        <Select
          value={kind}
          onChange={(value) =>
            setKind(releaseArtifactKinds.find((candidate) => candidate === value) ?? kind)
          }
          options={releaseArtifactKinds.map((value) => ({ value, label: t.kinds[value] }))}
          ariaLabel={t.fileRole}
          contentClassName={BLOCK_CLASS}
          disabled={pending}
        />
      </div>
      {kind === "manufacturingBom" && <BomCsvGuide />}
      <label className="grid min-w-0 gap-1 text-xs font-medium" htmlFor={inputId}>
        {t.productionFile}
        <Input
          id={inputId}
          type="file"
          name="releaseArtifact"
          accept={fileAccept[kind]}
          required
          disabled={pending}
        />
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <FilePlus className="size-4" aria-hidden="true" /> {t.addFile}
      </Button>
    </form>
  );
}

const requiredKinds: readonly ManualReleaseArtifactKind[] = ["pcbFabrication", "manufacturingBom"];

export function ApproveManufacturingRelease({
  release,
  pinnedQualityPlan,
  canApprove,
  pending,
  approve,
}: {
  release: ReleaseView;
  pinnedQualityPlan: QualityPlanVersion | undefined;
  canApprove: boolean;
  pending: boolean;
  approve: () => Promise<boolean>;
}) {
  const locale = useLocale();
  const t = manufacturingReleaseMessages[locale];
  const live = manufacturingReleaseLiveMessages[locale];
  const quality = qualityPlanMessages[locale];
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const missing = requiredKinds.filter(
    (kind) => !release.artifacts.some((artifact) => artifact.kind === kind),
  );
  const planUnavailable = release.qualityPlanVersionId != null && pinnedQualityPlan === undefined;
  return (
    <div className="space-y-2">
      {missing.length > 0 && (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {t.missingFiles} · {missing.map((kind) => t.kinds[kind]).join(", ")}
        </p>
      )}
      {canApprove && (
        <AlertDialog
          open={open}
          onOpenChange={(value) => {
            if (!pending) setOpen(value);
          }}
        >
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              disabled={pending || missing.length > 0 || planUnavailable}
              aria-describedby={missing.length > 0 ? descriptionId : undefined}
            >
              {t.approve}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className={`${BLOCK_CLASS} ph-no-capture`}>
            <AlertDialogHeader>
              <AlertDialogTitle>{live.approveTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {live.approveDescription}
                {pinnedQualityPlan !== undefined && (
                  <span className="mt-2 block">
                    <bdi className="font-medium">
                      {quality.version(pinnedQualityPlan.name, String(pinnedQualityPlan.version))}
                    </bdi>
                    <span className="mt-1 block">{quality.approvalHold}</span>
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{live.cancel}</AlertDialogCancel>
              <Button
                disabled={pending || missing.length > 0 || planUnavailable}
                onClick={() => {
                  // Leave the result visible alongside the package, including approval errors.
                  setOpen(false);
                  void approve();
                }}
              >
                {t.approve}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
