import { type ReactNode, useId } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateOnly, formatNumber } from "@/lib/localeFormatting";
import { agencyProjectsTranslator } from "../agencyProjectsMessages";
import type { TemplateDatePreview } from "./templateDatePreview";
import type { TemplateManifest } from "./templateManifestSchemas";

type Source = Pick<TemplateManifest["stages"][number], "id" | "label">;
type Entry = { label: string; value: ReactNode };

export function TemplatePreviewContents({
  manifest,
  dates,
}: {
  manifest: TemplateManifest;
  dates: TemplateDatePreview;
}) {
  const id = useId();
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  return (
    <>
      <div className="space-y-3">
        <h3 id={`${id}-stages`} className="font-semibold">
          {t("templatePreview.stages")}
        </h3>
        <ol aria-labelledby={`${id}-stages`} className="space-y-3">
          {manifest.stages.map((stage) => (
            <ContentRow
              key={stage.id}
              title={stage.label[preferences.locale]}
              entries={[
                { label: t("templatePreview.sourceReference"), value: <bdi>{stage.id}</bdi> },
                {
                  label: t("templatePreview.dependencies"),
                  value: <SourceDependencies items={manifest.stages} ids={stage.dependsOn} />,
                },
              ]}
            />
          ))}
        </ol>
      </div>
      <div className="space-y-3">
        <h3 id={`${id}-deliverables`} className="font-semibold">
          {t("templatePreview.deliverables")}
        </h3>
        {manifest.deliverables.length === 0 ? (
          <p>{t("templatePreview.noDeliverables")}</p>
        ) : (
          <ol aria-labelledby={`${id}-deliverables`} className="space-y-3">
            {manifest.deliverables.map((deliverable) => (
              <ContentRow
                key={deliverable.id}
                title={deliverable.label[preferences.locale]}
                entries={[
                  {
                    label: t("templatePreview.sourceReference"),
                    value: <bdi>{deliverable.id}</bdi>,
                  },
                  {
                    label: t("templatePreview.stage"),
                    value: <SourceReference items={manifest.stages} id={deliverable.stageId} />,
                  },
                  {
                    label: t("templatePreview.responsibleRole"),
                    value: (
                      <SourceReference items={manifest.roles} id={deliverable.responsibleRoleId} />
                    ),
                  },
                ]}
              />
            ))}
          </ol>
        )}
      </div>
      <div className="space-y-3">
        <h3 id={`${id}-intents`} className="font-semibold">
          {t("templatePreview.items")}
        </h3>
        {manifest.intents.length === 0 ? (
          <p>{t("templatePreview.noItems")}</p>
        ) : (
          <ol aria-labelledby={`${id}-intents`} className="space-y-3">
            {manifest.intents.map((intent) => (
              <IntentRow key={intent.id} intent={intent} manifest={manifest} dates={dates} />
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

function IntentRow({
  intent,
  manifest,
  dates,
}: {
  intent: TemplateManifest["intents"][number];
  manifest: TemplateManifest;
  dates: TemplateDatePreview;
}) {
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  const due = dates.intents.find((row) => row.intentId === intent.id);
  const entries: Entry[] = [
    { label: t("templatePreview.sourceReference"), value: <bdi>{intent.id}</bdi> },
    { label: t("templatePreview.kind"), value: t(`templatePreview.kinds.${intent.kind}`) },
    {
      label: t("templatePreview.stage"),
      value: <SourceReference items={manifest.stages} id={intent.stageId} />,
    },
    {
      label: t("templatePreview.dependencies"),
      value: <SourceDependencies items={manifest.intents} ids={intent.dependsOn} />,
    },
    {
      label: t("templatePreview.offset"),
      value: (
        <bdi>{formatNumber(intent.dueOffset.days, preferences, { signDisplay: "always" })}</bdi>
      ),
    },
    {
      label: t("templatePreview.dueDate"),
      value:
        due === undefined ? (
          t("templatePreview.dateUnavailable")
        ) : (
          <bdi>
            <time dateTime={due.dueDate}>{formatDateOnly(due.dueDate, preferences)}</time>
          </bdi>
        ),
    },
  ];
  if (intent.kind === "assignment") {
    entries.push(
      {
        label: t("templatePreview.internalProducerRole"),
        value: <SourceReference items={manifest.roles} id={intent.internalProducerRoleId} />,
      },
      {
        label: t("templatePreview.freelancerRole"),
        value: <SourceReference items={manifest.roles} id={intent.freelancerRoleId} />,
      },
    );
  } else {
    entries.push({
      label: t("templatePreview.responsibleRole"),
      value: <SourceReference items={manifest.roles} id={intent.assigneeRoleId} />,
    });
  }
  if (intent.kind !== "follow-up") {
    const deliverable = manifest.deliverables.find((source) => source.id === intent.deliverableId);
    entries.push(
      {
        label: t("templatePreview.deliverable"),
        value: <SourceReference items={manifest.deliverables} id={intent.deliverableId} />,
      },
      {
        label: t("templatePreview.deliverableStage"),
        value:
          deliverable === undefined ? (
            t("templatePreview.referenceUnavailable")
          ) : (
            <SourceReference items={manifest.stages} id={deliverable.stageId} />
          ),
      },
    );
  }
  return <ContentRow title={intent.label[preferences.locale]} entries={entries} />;
}

function SourceReference({ items, id }: { items: readonly Source[]; id: string }) {
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  const source = items.find((item) => item.id === id);
  return (
    <bdi>
      {source === undefined
        ? t("templatePreview.referenceUnavailable")
        : `${source.label[preferences.locale]} (${source.id})`}
    </bdi>
  );
}

function SourceDependencies({ items, ids }: { items: readonly Source[]; ids: readonly string[] }) {
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  if (ids.length === 0) return <span>{t("templatePreview.none")}</span>;
  return (
    <>
      {ids.map((id, index) => (
        <span key={id}>
          {index > 0 && (preferences.locale === "fa" ? "، " : ", ")}
          <SourceReference items={items} id={id} />
        </span>
      ))}
    </>
  );
}

function ContentRow({ title, entries }: { title: string; entries: readonly Entry[] }) {
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <h4 className="font-medium">
        <bdi>{title}</bdi>
      </h4>
      <dl className="space-y-2">
        {entries.map((entry) => (
          <TemplatePreviewDetail key={entry.label} label={entry.label}>
            {entry.value}
          </TemplatePreviewDetail>
        ))}
      </dl>
    </li>
  );
}

export function TemplatePreviewDetail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
