"use client";

import Link from "next/link";
import { PageHeading } from "@/components/shell/PageHeading";
import { useLocalePreferences, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import type { BuildRelease } from "../liveContracts";
import { manufacturingReleaseLiveMessages } from "./manufacturingReleaseLiveMessages";
import {
  ReleaseApprovalHistory,
  ReleaseArtifacts,
  ReleaseBom,
  ReleasePackageHeading,
} from "./ReleasePackageContent";

export function BuildReleasePage({ build }: { build: BuildRelease }) {
  const { locale } = useLocalePreferences();
  const numberingSystem = useNumberingSystem();
  const t = manufacturingReleaseLiveMessages[locale];
  const number = new Intl.NumberFormat(locale, { numberingSystem });

  return (
    <div className={cn(BLOCK_CLASS, "ph-no-capture mx-auto w-full max-w-3xl space-y-4")}>
      <PageHeading
        title={t.buildRelease}
        description={
          <span>
            <bdi dir="ltr">{build.sku}</bdi> · <bdi>{build.name}</bdi>
          </span>
        }
        actions={
          <Link
            href={`/projects/internal/${encodeURIComponent(build.projectId)}`}
            className="text-sm text-action hover:underline"
          >
            {t.project}
          </Link>
        }
      />
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div className="space-y-2">
          <ReleasePackageHeading release={build.release} />
          <p className="text-sm text-muted-foreground">
            {t.pinnedBuild(build.orderId.slice(0, 8))}
          </p>
          <p className="text-xs text-muted-foreground">
            {t.templateRevision} · <bdi>{number.format(build.templateRevision)}</bdi>
          </p>
        </div>
        <ReleaseArtifacts release={build.release} orderId={build.orderId} />
        <ReleaseBom bom={build.release.bom} />
        <ReleaseApprovalHistory release={build.release} />
      </section>
    </div>
  );
}
