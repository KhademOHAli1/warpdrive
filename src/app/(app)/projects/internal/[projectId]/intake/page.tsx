import { notFound } from "next/navigation";
import { projectIntakeWorkspaceInput } from "@/features/projects/intake/input";
import { ProjectIntakePage } from "@/features/projects/intake/ui/ProjectIntakePage";
import { readProjectIntakeWorkspace } from "@/features/projects/intake/webReads";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";

type Query = string | string[] | undefined;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ status?: Query; page?: Query; request?: Query }>;
}) {
  const { actorId } = await requireInternalProjects();
  const { projectId } = await params;
  const { status, page, request } = await searchParams;
  const input = projectIntakeWorkspaceInput.safeParse({
    projectId,
    filter: typeof status === "string" ? status : undefined,
    page: typeof page === "string" ? Number(page) : undefined,
    requestId: typeof request === "string" ? request : undefined,
  });
  if (!input.success) notFound();
  const [workspace, queue] = await Promise.all([
    readInternalWorkspace(projectId),
    readProjectIntakeWorkspace(input.data),
  ]);
  if (!workspace.ok || !queue.ok) notFound();
  return (
    <div className="space-y-4">
      <ProjectTypeNav active="internal" />
      <ProjectIntakePage
        key={`${actorId}:${projectId}:${input.data.requestId ?? ""}`}
        actorId={actorId}
        project={workspace.value.project}
        queue={queue.value}
        filter={input.data.filter}
        page={input.data.page}
        restrictedGuest={workspace.value.guestAccess === "restricted"}
      />
    </div>
  );
}
