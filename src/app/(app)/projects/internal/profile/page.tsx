import { getLocalePreferences } from "@/features/i18n/server";
import { ProfileStats } from "@/features/projects/profile/ProfileStats";
import { ProjectProfileShell } from "@/features/projects/profile/ProjectProfileShell";
import { readProfileSummary } from "@/features/projects/profile/webReads";
import { requireInternalProjects } from "@/features/projects/webReads";

export default async function YourWorkPage() {
  await requireInternalProjects();
  const [summary, preferences] = await Promise.all([readProfileSummary(), getLocalePreferences()]);
  return (
    <ProjectProfileShell
      active="summary"
      preferences={preferences}
      {...(summary.ok ? { member: summary.value.member } : {})}
    >
      {summary.ok ? <ProfileStats summary={summary.value} preferences={preferences} /> : null}
    </ProjectProfileShell>
  );
}
