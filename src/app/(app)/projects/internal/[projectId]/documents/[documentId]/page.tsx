import { notFound } from "next/navigation";
import { DepartureGuardProvider } from "@/features/company-profile/ui/useDepartureGuard";
import { ProjectPage } from "@/features/projects/documents/ui/ProjectPage";
import {
  readProjectDocument,
  readProjectDocumentVersion,
} from "@/features/projects/documents/webReads";
import { projectIdInput } from "@/features/projects/input";
import { ProjectTypeNav } from "@/features/projects/ProjectTypeNav";
import { readInternalWorkspace, requireInternalProjects } from "@/features/projects/webReads";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const { actorId } = await requireInternalProjects();
  const raw = await params;
  const projectId = projectIdInput.safeParse(raw.projectId);
  const documentId = projectIdInput.safeParse(raw.documentId);
  if (!projectId.success || !documentId.success) notFound();
  const { version } = await searchParams;
  const revision = typeof version === "string" && /^\d+$/.test(version) ? Number(version) : null;
  if (version !== undefined && (revision === null || !Number.isSafeInteger(revision))) notFound();
  const [detail, workspace, history] = await Promise.all([
    readProjectDocument({ projectId: projectId.data, documentId: documentId.data }),
    readInternalWorkspace(projectId.data),
    revision === null
      ? Promise.resolve(null)
      : readProjectDocumentVersion({
          projectId: projectId.data,
          documentId: documentId.data,
          versionRevision: revision,
        }),
  ]);
  if (!detail.ok || !workspace.ok || (history !== null && !history.ok)) notFound();
  return (
    <DepartureGuardProvider>
      <div className="space-y-4">
        <ProjectTypeNav active="internal" />
        <ProjectPage
          key={`${actorId}:${documentId.data}:${revision ?? "current"}`}
          actorId={actorId}
          project={workspace.value.project}
          initial={detail.value}
          version={history?.value ?? null}
        />
      </div>
    </DepartureGuardProvider>
  );
}
