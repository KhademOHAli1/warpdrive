import { useId } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { agencyProjectsTranslator } from "../agencyProjectsMessages";
import { TemplatePreviewDetail } from "./TemplatePreviewContents";
import type { TemplateInstallPreviewData } from "./templateInstallPreviewTypes";
import type { TemplateRoleBindingPreview, TemplateRoleTarget } from "./templateRolePreview";

export function TemplatePreviewRoles({
  data,
  preview,
}: {
  data: TemplateInstallPreviewData;
  preview: TemplateRoleBindingPreview;
}) {
  const id = useId();
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  return (
    <div className="space-y-3">
      <h3 id={id} className="font-semibold">
        {t("templatePreview.roles")}
      </h3>
      <ol aria-labelledby={id} className="space-y-3">
        {preview.roles.map((role) => (
          <li key={role.roleId} className="space-y-2 rounded-lg border p-3">
            <h4 className="font-medium">
              <bdi>
                {data.manifest.roles.find((source) => source.id === role.roleId)?.label[
                  preferences.locale
                ] ?? t("templatePreview.referenceUnavailable")}
              </bdi>
            </h4>
            <p className="text-sm text-muted-foreground">
              {t(
                role.roleKind === "internal-producer"
                  ? "templatePreview.internalUser"
                  : "templatePreview.freelancerContact",
              )}
            </p>
            <dl>
              <TemplatePreviewDetail label={t("templatePreview.sourceReference")}>
                <bdi>{role.roleId}</bdi>
              </TemplatePreviewDetail>
              <TemplatePreviewDetail label={t("templatePreview.selectedIdentity")}>
                <RoleIdentity binding={role.binding} data={data} />
              </TemplatePreviewDetail>
            </dl>
            {role.uses.length === 0 && <p>{t("templatePreview.unusedRole")}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RoleIdentity({
  binding,
  data,
}: {
  binding: TemplateRoleTarget | null;
  data: TemplateInstallPreviewData;
}) {
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  if (binding === null) return <span>{t("templatePreview.unmapped")}</span>;
  const label =
    binding.kind === "internal-user"
      ? data.userLabels[binding.userId]
      : data.personLabels[binding.personId];
  return (
    <bdi>
      {label !== undefined && label.trim().length > 0
        ? label
        : t(
            binding.kind === "internal-user"
              ? "templatePreview.userUnavailable"
              : "templatePreview.contactUnavailable",
          )}
    </bdi>
  );
}
