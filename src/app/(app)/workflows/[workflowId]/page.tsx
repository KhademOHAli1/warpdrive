import { notFound } from "next/navigation";
import { getWorkflow } from "@/features/workflows/queries";
import { WorkflowEditor } from "@/features/workflows/ui/WorkflowEditor";
import { createContext } from "@/server/trpc/context";

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
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
  return <WorkflowEditor initial={workflow.value} />;
}
