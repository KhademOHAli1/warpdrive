import { notFound } from "next/navigation";
import { sanitizeLibraryReturnTo } from "@/features/workflows/ui/libraryLocation";
import { WorkflowEditor } from "@/features/workflows/ui/WorkflowEditor";
import { WorkflowStudio } from "@/features/workflows/v2/ui/WorkflowStudio";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";

export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ workflowId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await createContext();
  if (ctx.actor === null) notFound();
  const id = (await params).workflowId;
  const workflow = await coreClient().frontend.workflowPage.query({ id });
  if (workflow === null) notFound();
  const search = await searchParams;
  if (workflow.engine === 2) {
    return (
      <WorkflowStudio
        key={workflow.value.id}
        initial={workflow.value}
        returnTo={sanitizeLibraryReturnTo(search.returnTo)}
        initialHistory={search.history === "1"}
      />
    );
  }
  return (
    <WorkflowEditor
      key={workflow.value.id}
      initial={workflow.value}
      returnTo={sanitizeLibraryReturnTo(search.returnTo)}
      initialHistory={search.history === "1"}
    />
  );
}
