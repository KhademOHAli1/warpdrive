import { redirect } from "next/navigation";
import { getLocalePreferences } from "@/features/i18n/server";
import { profileActivityInput } from "@/features/projects/profile/contracts";
import { ProfileActivity } from "@/features/projects/profile/ProfileActivity";
import { ProjectProfileShell } from "@/features/projects/profile/ProjectProfileShell";
import { profileActivityPath } from "@/features/projects/profile/paths";
import { readProfileActivity } from "@/features/projects/profile/webReads";
import { requireInternalProjects } from "@/features/projects/webReads";

export default async function ProjectProfileActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireInternalProjects();
  const { after, afterId } = await searchParams;
  const input = profileActivityInput.safeParse({
    cursor:
      after === undefined && afterId === undefined ? undefined : { createdAt: after, id: afterId },
  });
  if (!input.success) redirect(profileActivityPath());
  const [result, preferences] = await Promise.all([
    readProfileActivity(input.data.cursor),
    getLocalePreferences(),
  ]);
  return (
    <ProjectProfileShell
      active="activity"
      preferences={preferences}
      {...(result.ok ? { member: result.value.member } : {})}
    >
      {result.ok ? (
        <ProfileActivity
          activity={result.value}
          cursor={input.data.cursor}
          preferences={preferences}
        />
      ) : null}
    </ProjectProfileShell>
  );
}
