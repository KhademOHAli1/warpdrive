import { notFound } from "next/navigation";
import { getWorkflow } from "@/features/workflows/queries";
import { sanitizeLibraryReturnTo } from "@/features/workflows/ui/libraryLocation";
import { WorkflowEditor } from "@/features/workflows/ui/WorkflowEditor";
import { createContext } from "@/server/trpc/context";

export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ workflowId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await createContext();
  if (ctx.actor === null) notFound();
  const workflow = await getWorkflow(
    ctx.db,
    ctx.actor,
    (await params).workflowId,
    AbortSignal.timeout(10_000),
  );
  if (!workflow.ok) notFound();
  const search = await searchParams;
  return (
    <WorkflowEditor
      key={workflow.value.id}
      initial={workflow.value}
      returnTo={sanitizeLibraryReturnTo(search.returnTo)}
      initialHistory={search.history === "1"}
    />
  );
}
