import { notFound } from "next/navigation";
import { readWorkflowV2FormAction } from "@/features/workflows/v2/actions";
import { WorkflowRequestResponse } from "@/features/workflows/v2/ui/WorkflowRequests";
export default async function WorkflowResponsePage({
  params,
}: {
  params: Promise<{ waitId: string }>;
}) {
  const result = await readWorkflowV2FormAction((await params).waitId);
  if (!result.ok) notFound();
  return <WorkflowRequestResponse request={result.value} />;
}
