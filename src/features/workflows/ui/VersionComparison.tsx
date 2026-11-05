"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type {
  ConnectionDifference,
  StepDifference,
  VersionDifference,
} from "./publishedVersionDiff";

function StepNames({ title, steps }: { title: string; steps: VersionDifference["addedSteps"] }) {
  return (
    <section className="space-y-2">
      <h4 className="font-medium">{title}</h4>
      <ul className="list-inside list-disc space-y-1">
        {steps.map((step) => (
          <li key={step.ordinal}>
            <bdi>{step.name}</bdi>
          </li>
        ))}
      </ul>
    </section>
  );
}
function Connections({
  title,
  connections,
}: {
  title: string;
  connections: ConnectionDifference[];
}) {
  const t = useAppTranslations("workflows");
  return (
    <section className="space-y-2">
      <h4 className="font-medium">{title}</h4>
      <ul className="space-y-2">
        {connections.map((connection) => (
          <li key={connection.ordinal} className="flex flex-wrap items-center gap-2">
            <bdi>{connection.fromName}</bdi>
            <ArrowRight aria-hidden="true" className="size-3 shrink-0 rtl:rotate-180" />
            <bdi>{connection.toName}</bdi>
            <span className="text-muted-foreground">
              {t(
                connection.port === "next"
                  ? "versionComparePortNext"
                  : connection.port === "true"
                    ? "versionComparePortTrue"
                    : "versionComparePortFalse",
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
function ChangedSteps({ steps }: { steps: StepDifference[] }) {
  const t = useAppTranslations("workflows");
  return (
    <section className="space-y-2">
      <h4 className="font-medium">{t("versionCompareChangedSteps", { count: steps.length })}</h4>
      <ul className="space-y-3">
        {steps.map((step) => (
          <li key={step.ordinal} className="min-w-0 rounded-md border p-3">
            <p className="flex flex-wrap items-center gap-2 break-words [overflow-wrap:anywhere]">
              <bdi>{step.beforeName}</bdi>
              {step.nameChanged && (
                <>
                  <ArrowRight aria-hidden="true" className="size-3 shrink-0 rtl:rotate-180" />
                  <bdi>{step.afterName}</bdi>
                </>
              )}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              {step.nameChanged && <li>{t("versionCompareStepName")}</li>}
              {step.kindChanged && <li>{t("versionCompareStepKind")}</li>}
              {step.versionChanged && <li>{t("versionCompareStepVersion")}</li>}
              {step.namingChanged && <li>{t("versionCompareStepNaming")}</li>}
              {step.configurationChanged && <li>{t("versionCompareStepConfiguration")}</li>}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function VersionComparison({
  beforeNumber,
  afterNumber,
  phase,
  difference,
  retrying,
  onRetry,
}: {
  beforeNumber: number;
  afterNumber: number;
  phase: "loading" | "unavailable" | "ready";
  difference: VersionDifference | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  const t = useAppTranslations("workflows");
  return (
    <section
      aria-label={t("versionCompareTitle")}
      className="min-w-0 space-y-4 rounded-lg border p-4 text-sm"
    >
      <header className="space-y-1">
        <h3 className="font-semibold">{t("versionCompareTitle")}</h3>
        <p className="text-muted-foreground">
          {t("versionComparePair", { before: beforeNumber, after: afterNumber })}
        </p>
      </header>
      {phase === "loading" && <p role="status">{t("loading")}</p>}
      {phase === "unavailable" && (
        <div className="space-y-2">
          <p role="alert" className="text-destructive">
            {t("versionCompareUnavailable")}
          </p>
          <Button variant="outline" disabled={retrying} onClick={onRetry}>
            {t("retry")}
          </Button>
        </div>
      )}
      {phase === "ready" && difference !== null && (
        <>
          <p className="text-muted-foreground">{t("versionCompareValuesHint")}</p>
          {difference.unchanged && <p role="status">{t("versionCompareUnchanged")}</p>}
          {difference.nameChanged && <p>{t("versionCompareWorkflowName")}</p>}
          {difference.layoutChanged && <p>{t("versionCompareLayout")}</p>}
          {difference.addedSteps.length > 0 && (
            <StepNames
              title={t("versionCompareAddedSteps", { count: difference.addedSteps.length })}
              steps={difference.addedSteps}
            />
          )}
          {difference.removedSteps.length > 0 && (
            <StepNames
              title={t("versionCompareRemovedSteps", { count: difference.removedSteps.length })}
              steps={difference.removedSteps}
            />
          )}
          {difference.changedSteps.length > 0 && <ChangedSteps steps={difference.changedSteps} />}
          {difference.addedConnections.length > 0 && (
            <Connections
              title={t("versionCompareAddedConnections", {
                count: difference.addedConnections.length,
              })}
              connections={difference.addedConnections}
            />
          )}
          {difference.removedConnections.length > 0 && (
            <Connections
              title={t("versionCompareRemovedConnections", {
                count: difference.removedConnections.length,
              })}
              connections={difference.removedConnections}
            />
          )}
        </>
      )}
    </section>
  );
}
