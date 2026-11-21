import { notFound, redirect } from "next/navigation";
import { getLocalePreferences } from "@/features/i18n/server";
import { profileItemsInput } from "@/features/projects/profile/contracts";
import { ProfileItems } from "@/features/projects/profile/ProfileItems";
import { ProjectProfileShell } from "@/features/projects/profile/ProjectProfileShell";
import { profileItemsPath } from "@/features/projects/profile/paths";
import { readProfileItems } from "@/features/projects/profile/webReads";
import { requireInternalProjects } from "@/features/projects/webReads";

export default async function ProjectProfileItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireInternalProjects();
  const [{ view }, { status, priority, after, afterId }] = await Promise.all([
    params,
    searchParams,
  ]);
  if (view !== "assigned" && view !== "created" && view !== "subscribed") notFound();
  const input = profileItemsInput.safeParse({
    status,
    priority,
    cursor:
      after === undefined && afterId === undefined ? undefined : { createdAt: after, id: afterId },
  });
  if (!input.success) redirect(profileItemsPath(view));
  const [page, preferences] = await Promise.all([
    readProfileItems(view, input.data),
    getLocalePreferences(),
  ]);
  return (
    <ProjectProfileShell
      active={view}
      preferences={preferences}
      {...(page.ok ? { member: page.value.member } : {})}
    >
      {page.ok ? (
        <ProfileItems view={view} page={page.value} filter={input.data} preferences={preferences} />
      ) : null}
    </ProjectProfileShell>
  );
}
