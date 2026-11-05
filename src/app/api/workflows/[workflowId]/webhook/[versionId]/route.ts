import { db } from "@/db/client";
import { nudgeWorkflowRun } from "@/features/workflows/worker";
import { admitWorkflowWebhookDelivery } from "@/features/workflows/workflowWebhookAdmission";
import {
  handleWorkflowWebhookRequest,
  workflowWebhookMethodNotAllowed,
} from "@/features/workflows/workflowWebhookHttp";
import { workflowWebhookOperatorServices } from "@/features/workflows/workflowWebhookOperator";

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

function rejectMethod(request: Request): Response {
  return workflowWebhookMethodNotAllowed(request);
}

export {
  handle as GET,
  handle as POST,
  rejectMethod as DELETE,
  rejectMethod as HEAD,
  rejectMethod as OPTIONS,
  rejectMethod as PATCH,
  rejectMethod as PUT,
};
