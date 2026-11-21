import type { ReactNode } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Avatar } from "@/components/ui/Avatar";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { FormattingPreferences } from "@/lib/localeFormatting";
import type { ProjectPerson } from "../contracts";
import { ProjectTypeNav } from "../ProjectTypeNav";
import type { ProfileTab } from "./contracts";
import { projectProfileTranslator } from "./messages";
import { ProfileNavigation } from "./ProfileNavigation";

export function ProjectProfileShell({
  active,
  children,
  member,
  preferences,
}: {
  active: ProfileTab;
  children?: ReactNode;
  member?: ProjectPerson;
  preferences: FormattingPreferences;
}) {
  const t = projectProfileTranslator(preferences.locale, preferences.numberingSystem);
  return (
    <section className={`${BLOCK_CLASS} ph-no-capture space-y-4`}>
      <ProjectTypeNav active="profile" />
      <PageHeading
        title={t("title")}
        actions={
          member ? (
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <span aria-hidden>
                <Avatar name={member.name} />
              </span>
              <bdi className="min-w-0 [overflow-wrap:anywhere]">{member.name}</bdi>
            </div>
          ) : undefined
        }
      />
      <ProfileNavigation active={active} preferences={preferences} />
      {children ?? <p role="alert">{t("unavailable")}</p>}
    </section>
  );
}
