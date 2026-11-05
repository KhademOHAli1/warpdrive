import { listPendingWorkflowV2InputsAction } from "@/features/workflows/v2/actions";
import { WorkflowRequestList } from "@/features/workflows/v2/ui/WorkflowRequests";
export default async function WorkflowRequestsPage() {
  const result = await listPendingWorkflowV2InputsAction();
  return <WorkflowRequestList requests={result.ok ? result.value : []} error={!result.ok} />;
}
