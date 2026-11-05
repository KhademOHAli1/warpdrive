import { notFound } from "next/navigation";
import { getWorkflow } from "@/features/workflows/queries";
import { sanitizeLibraryReturnTo } from "@/features/workflows/ui/libraryLocation";
import { WorkflowEditor } from "@/features/workflows/ui/WorkflowEditor";
import { readWorkflowV2 } from "@/features/workflows/v2/persistence";
import { resolveWorkflowEngine } from "@/features/workflows/v2/queries";
import { WorkflowStudio } from "@/features/workflows/v2/ui/WorkflowStudio";
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
  const id = (await params).workflowId;
  const engine = await resolveWorkflowEngine(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000));
  if (!engine.ok) notFound();
  const search = await searchParams;
  if (engine.value === 2) {
    const workflow = await readWorkflowV2(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000));
    if (!workflow.ok) notFound();
    return (
      <WorkflowStudio
        key={workflow.value.id}
        initial={workflow.value}
        returnTo={sanitizeLibraryReturnTo(search.returnTo)}
        initialHistory={search.history === "1"}
      />
    );
  }
  const workflow = await getWorkflow(ctx.db, ctx.actor, id, AbortSignal.timeout(10_000));
  if (!workflow.ok) notFound();
  return (
    <WorkflowEditor
      key={workflow.value.id}
      initial={workflow.value}
      returnTo={sanitizeLibraryReturnTo(search.returnTo)}
      initialHistory={search.history === "1"}
    />
  );
}
