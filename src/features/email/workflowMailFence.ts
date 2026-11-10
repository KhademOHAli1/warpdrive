import { createHash } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import type {
  BlockJson,
  BlockOutput,
  WorkflowV2Definition,
  WorkflowV2RunState,
} from "@/features/blocks/contracts";
import { canWorkflow } from "@/features/workflows/access";
import { boundSourcesVisible } from "@/features/workflows/v2/sourceAuthority";
import { hydrateActor } from "@/server/hydrateActor";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export interface WorkflowMailDispatch {
  readonly purpose: {
    readonly version: 1;
    readonly runId: string;
    readonly executionId: string;
    readonly effectKey: string;
    readonly actorId: string;
    readonly provider: "gmail" | "imap_smtp";
    readonly generation: number;
    readonly requestDigest: string;
  };
  readonly request: BlockOutput;
}

export function workflowMailRequestDigest(request: BlockOutput): string {
  function canonical(value: BlockJson): BlockJson {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(canonical);
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key] as BlockJson)]),
    );
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("hex");
}

// The marker is server-only, separate from notification purpose. A malformed
// marker also excludes the row from the ordinary mail pipeline.
export function workflowMailScope(payload: SQL, dispatch?: WorkflowMailDispatch): SQL {
  return dispatch === undefined
    ? sql`NOT (${payload} ? 'workflowPurpose')`
    : sql`${payload}->'workflowPurpose'=${JSON.stringify(dispatch.purpose)}::jsonb`;
}

// Earlier V2 attempts used the effect key without a purpose marker. Do not
// let a rolling upgrade or an orphaned ordinary job submit that old attempt.
export function isNotLegacyWorkflowMail(key: SQL): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM workflow_v2_effects e WHERE e.effect_key=${key})`;
}

export function currentWorkflowMailLease(dispatch: WorkflowMailDispatch): SQL {
  return sql`EXISTS (SELECT 1 FROM workflow_v2_effects
    WHERE effect_key=${dispatch.purpose.effectKey}
      AND status='claimed' AND lease_until>clock_timestamp())`;
}

interface MailRunAuthority {
  owner_id: string;
  node_id: string;
  definition: WorkflowV2Definition;
  state: WorkflowV2RunState;
  frame_path: string[];
  trigger: BlockOutput;
}

export async function guardWorkflowMailSubmission(
  tx: DbOrTx,
  dispatch: WorkflowMailDispatch,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const { purpose, request } = dispatch;
  if (purpose.requestDigest !== workflowMailRequestDigest(request)) return false;
  // The run lock serializes this boundary with cancellation and effect expiry.
  const run = await tx.execute(sql`SELECT id FROM workflow_v2_runs WHERE id=${purpose.runId}
    AND actor_id=${purpose.actorId} AND mode='live' AND status IN ('queued','running')
    FOR UPDATE`);
  if (run.rows.length !== 1) return false;
  const actor = await hydrateActor(tx, purpose.actorId, signal);
  if (actor === null) return false;
  const authority = (
    await tx.execute<
      MailRunAuthority & Record<string, unknown>
    >(sql`SELECT w.owner_id,x.node_id,v.definition,r.state,x.frame_path,r.trigger
      FROM workflow_v2_effects e
      JOIN workflow_v2_runs r ON r.id=e.run_id
      JOIN workflows_v2 w ON w.id=r.workflow_id
      JOIN workflow_v2_versions v ON v.id=r.version_id AND v.workflow_id=w.id
      JOIN workflow_v2_executions x ON x.id=e.execution_id AND x.run_id=r.id
      WHERE e.run_id=${purpose.runId} AND e.execution_id=${purpose.executionId}
        AND e.effect_key=${purpose.effectKey} AND e.request=${JSON.stringify(request)}::jsonb
        AND e.status='claimed' AND e.lease_until>clock_timestamp() AND x.status='running'
        AND x.visit_key=r.state->'queue'->0->>'visitKey'
        AND w.active AND w.archived_at IS NULL
      FOR SHARE OF w`)
  ).rows[0];
  signal.throwIfAborted();
  if (authority === undefined || !canWorkflow(actor, "run", authority.owner_id)) return false;
  const node = authority.definition.nodes.find((candidate) => candidate.id === authority.node_id);
  return (
    node?.type === "SEND_EMAIL" &&
    boundSourcesVisible(
      tx,
      actor,
      authority.definition,
      node,
      authority.state,
      authority.frame_path,
      authority.trigger,
      signal,
    )
  );
}
