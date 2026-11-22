"use client";

import { Download, Trash2 } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { AttachmentIcon } from "@/features/files/AttachmentIcon";
import { useLocalePreferences, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import type { ReleaseView } from "../liveContracts";
import { manufacturingReleaseLiveMessages } from "./manufacturingReleaseLiveMessages";
import { manufacturingReleaseMessages } from "./manufacturingReleaseMessages";

function artifactHref(releaseId: string, artifactId: string, orderId?: string) {
  const path = `/api/inventory/releases/${encodeURIComponent(releaseId)}/files/${encodeURIComponent(artifactId)}`;
  return orderId === undefined ? path : `${path}?orderId=${encodeURIComponent(orderId)}`;
}

export function ReleaseArtifacts({
  release,
  orderId,
  remove,
  pending,
}: {
  release: ReleaseView;
  orderId?: string;
  remove?: (artifactId: string) => void;
  pending?: boolean;
}) {
  const { locale } = useLocalePreferences();
  const t = manufacturingReleaseMessages[locale];
  const { checksumAlgorithm } = manufacturingReleaseLiveMessages[locale];
  const numberingSystem = useNumberingSystem();
  const size = new Intl.NumberFormat(locale, { numberingSystem, style: "unit", unit: "byte" });
  const artifacts = [...release.artifacts, ...(release.pcbSourceArtifacts ?? [])];
  if (artifacts.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.noFiles}</p>;
  }

  return (
    <ul className="divide-y rounded-md border px-2">
      {artifacts.map((artifact) => (
        <li key={artifact.id} className="flex items-center justify-between gap-1.5 py-1.5">
          <div className="flex min-w-0 items-start gap-1.5">
            <AttachmentIcon filename={artifact.name} />
            <div className="min-w-0">
              <bdi className="block break-all text-sm">{artifact.name}</bdi>
              <span className="text-xs text-muted-foreground">
                {t.kinds[artifact.kind]} · {size.format(artifact.sizeBytes)}
              </span>
              <span className="block break-all font-mono text-xs text-muted-foreground">
                <bdi dir="ltr">
                  {checksumAlgorithm} {artifact.sha256}
                </bdi>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <a
              className={buttonVariants({ variant: "ghost", size: "icon" })}
              href={artifactHref(release.id, artifact.id, orderId)}
              aria-label={`${t.download} ${artifact.name}`}
              download={artifact.name}
            >
              <Download className="size-4" aria-hidden="true" />
            </a>
            {remove !== undefined && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t.remove} ${artifact.name}`}
                onClick={() => remove(artifact.id)}
                disabled={pending}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReleasePackageHeading({ release }: { release: ReleaseView }) {
  const { locale } = useLocalePreferences();
  const t = manufacturingReleaseMessages[locale];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">
        {t.packageFiles} ·{" "}
        <bdi>
          {t.shortRevision} {release.revision}
        </bdi>
      </h2>
      <Badge variant={release.status === "draft" ? "secondary" : "success"}>
        {release.status === "draft" ? t.draft : t.released}
      </Badge>
    </div>
  );
}

export function ReleaseApprovalHistory({ release }: { release: ReleaseView }) {
  const preferences = useLocalePreferences();
  const t = manufacturingReleaseLiveMessages[preferences.locale];
  const headingId = useId();
  const hydrated = useHydrated();
  const dates = new Intl.DateTimeFormat(localeTagForFormatting(preferences), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: preferences.timeZone,
  });
  const displayTime = (value: string) => (hydrated ? dates.format(new Date(value)) : value);

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {t.approvalHistory}
      </h3>
      <dl className="grid gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t.createdBy}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-2 break-all">
            <bdi>{release.createdBy.name}</bdi>
            <time className="text-xs text-muted-foreground" dateTime={release.createdAt}>
              {displayTime(release.createdAt)}
            </time>
          </dd>
        </div>
        {release.approvedAt !== null && release.approvedBy !== null ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t.approvedBy}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2 break-all">
              <bdi>{release.approvedBy.name}</bdi>
              <time className="text-xs text-muted-foreground" dateTime={release.approvedAt}>
                {displayTime(release.approvedAt)}
              </time>
            </dd>
          </div>
        ) : (
          <div>
            <dt className="sr-only">{t.approvedBy}</dt>
            <dd className="text-xs text-muted-foreground">{t.awaitingApproval}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export function ReleaseBom({ bom }: { bom: ReleaseView["bom"] }) {
  const { locale } = useLocalePreferences();
  const numberingSystem = useNumberingSystem();
  const t = manufacturingReleaseLiveMessages[locale];
  const headingId = useId();
  const quantity = new Intl.NumberFormat(locale, { numberingSystem });

  if (bom.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {t.bom}
      </h3>
      <table className="w-full table-fixed text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-1 text-start font-medium">
              {t.material}
            </th>
            <th scope="col" className="w-24 px-2 py-1 text-end font-medium">
              {t.quantityPerUnit}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {bom.map((component) => (
            <tr key={component.itemId}>
              <td className="px-2 py-1.5">
                <bdi className="block break-all">{component.name}</bdi>
                <bdi className="text-xs text-muted-foreground" dir="ltr">
                  {component.sku}
                </bdi>
              </td>
              <td className="px-2 py-1.5 text-end tabular-nums">
                {quantity.format(component.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
