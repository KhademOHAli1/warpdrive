import { db } from "@/db/client";
import { nudgeWorkflowRun } from "@/features/workflows/worker";
import { admitWorkflowWebhookDelivery } from "@/features/workflows/workflowWebhookAdmission";
import { handleWorkflowWebhookRequest } from "@/features/workflows/workflowWebhookHttp";
import { workflowWebhookOperatorServices } from "@/features/workflows/workflowWebhookOperator";

export {
  workflowWebhookMethodNotAllowed as DELETE,
  workflowWebhookMethodNotAllowed as HEAD,
  workflowWebhookMethodNotAllowed as OPTIONS,
  workflowWebhookMethodNotAllowed as PATCH,
  workflowWebhookMethodNotAllowed as PUT,
} from "@/features/workflows/workflowWebhookHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ workflowId: string; versionId: string }> };

async function handle(request: Request, context: Context): Promise<Response> {
  return handleWorkflowWebhookRequest(request, await context.params, {
    admit: (input, signal) =>
      admitWorkflowWebhookDelivery(db, input, workflowWebhookOperatorServices, signal),
    nudge: nudgeWorkflowRun,
  });
}

export { handle as GET, handle as POST };
