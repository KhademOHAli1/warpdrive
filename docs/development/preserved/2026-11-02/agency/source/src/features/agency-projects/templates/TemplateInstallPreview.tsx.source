"use client";

import { useId } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateOnly, formatNumber } from "@/lib/localeFormatting";
import { agencyProjectsTranslator } from "../agencyProjectsMessages";
import { TemplatePreviewContents, TemplatePreviewDetail } from "./TemplatePreviewContents";
import { TemplatePreviewRoles } from "./TemplatePreviewRoles";
import { previewTemplateDates } from "./templateDatePreview";
import type {
  TemplateInstallPreviewData,
  TemplateInstallPreviewProps,
} from "./templateInstallPreviewTypes";
import { previewTemplateRoleBindings } from "./templateRolePreview";

const PRIVATE = `${BLOCK_CLASS} ph-no-capture`;

function currentPacket(props: TemplateInstallPreviewProps): TemplateInstallPreviewData | null {
  const { data, target } = props;
  if (!props.canRead || props.contextKey.trim().length === 0 || data === null || target === null)
    return null;
  if (
    target.projectId.trim().length === 0 ||
    target.selectionKey.trim().length === 0 ||
    data.contextKey !== props.contextKey ||
    data.target.projectId !== target.projectId ||
    data.target.templateId !== target.templateId ||
    data.target.version !== target.version ||
    data.target.selectionKey !== target.selectionKey ||
    data.manifest.templateId !== target.templateId ||
    data.manifest.version !== target.version
  )
    return null;
  return data;
}

export function TemplateInstallPreview(props: TemplateInstallPreviewProps) {
  const id = useId();
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  const data = currentPacket(props);
  if (data === null)
    return (
      <p role="alert" className={PRIVATE} dir={directionForLocale(preferences.locale)}>
        {t("templatePreview.unavailable")}
      </p>
    );
  // Both projections belong to this packet. No externally cached projection is joined here.
  const roles = previewTemplateRoleBindings(data.manifest, data.bindings);
  const dates = previewTemplateDates(data.manifest, data.projectStart);
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={`${PRIVATE} space-y-4`}
      dir={directionForLocale(preferences.locale)}
    >
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {t("templatePreview.title")}
      </h2>
      <p>{t("templatePreview.unverified")}</p>
      <p className="text-sm text-muted-foreground">{t("templatePreview.calendarDaysNotice")}</p>
      <dl className="space-y-2">
        <TemplatePreviewDetail label={t("templatePreview.template")}>
          <bdi>{data.manifest.label[preferences.locale]}</bdi>
        </TemplatePreviewDetail>
        <TemplatePreviewDetail label={t("templatePreview.templateReference")}>
          <bdi>{data.manifest.templateId}</bdi>
        </TemplatePreviewDetail>
        <TemplatePreviewDetail label={t("templatePreview.version")}>
          <bdi>{formatNumber(data.manifest.version, preferences)}</bdi>
        </TemplatePreviewDetail>
      </dl>
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        <bdi>{data.manifest.description[preferences.locale]}</bdi>
      </p>
      {!roles.ok && <p role="alert">{t("templatePreview.invalidBindings")}</p>}
      {!dates.ok && <p role="alert">{t("templatePreview.invalidDates")}</p>}
      {roles.ok && dates.ok && (
        <>
          <dl>
            <TemplatePreviewDetail label={t("templatePreview.projectStart")}>
              <bdi>
                <time dateTime={dates.value.projectStart}>
                  {formatDateOnly(dates.value.projectStart, preferences)}
                </time>
              </bdi>
            </TemplatePreviewDetail>
          </dl>
          <TemplatePreviewRoles data={data} preview={roles.value} />
          <TemplatePreviewContents manifest={data.manifest} dates={dates.value} />
        </>
      )}
    </section>
  );
}
