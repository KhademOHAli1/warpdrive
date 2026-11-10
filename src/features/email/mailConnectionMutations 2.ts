import { sql } from "drizzle-orm";
import { z } from "zod";
import { PGBOSS_QUEUE_EMAIL_SYNC } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { recordSecurityEvent } from "@/features/auth/management/audit";
import { getBoss } from "@/jobs/boss";
import { err, ok } from "@/types/result";
import type { MailboxConnectionMutation, MailboxConnectionResult } from "./connections/types";
import { disconnectMailbox, selectDefaultMailbox } from "./mailAccountsRepo";
import { lockMailboxSession } from "./mailConnectionProofContext";
import type { MailboxActorSession } from "./mailConnectionSchemas";

const mutationSchema = z.strictObject({
  accountId: z.uuid(),
  action: z.enum(["pause", "resume", "retry", "disconnect", "setDefault"]),
});
type EnqueueSync = (accountId: string, signal: AbortSignal) => Promise<boolean>;
interface MutationDependencies {
  enqueueSync?: EnqueueSync | null;
}
interface OwnedMailbox {
  id: string;
  status: string;
  paused: boolean;
  can_send: boolean;
}

function availableQueue(): EnqueueSync | null {
  const boss = getBoss();
  if (boss === null) return null;
  return async (accountId, signal) => {
    signal.throwIfAborted();
    const queued = await boss.send(PGBOSS_QUEUE_EMAIL_SYNC, { accountId });
    signal.throwIfAborted();
    return queued !== null;
  };
}

async function applyMutation(
  db: Db,
  actorId: string,
  row: OwnedMailbox,
  action: MailboxConnectionMutation,
  signal: AbortSignal,
): Promise<MailboxConnectionResult<void>> {
  if (action === "disconnect") {
    const result = await disconnectMailbox(db, actorId, row.id, signal);
    return result.ok ? ok(undefined) : err("permission");
  }
  if (action === "setDefault") {
    if (row.paused || row.status !== "connected" || !row.can_send) return err("connection_changed");
    const result = await selectDefaultMailbox(db, actorId, row.id, signal);
    return result.ok ? ok(undefined) : err("connection_changed");
  }
  if (action === "retry") return ok(undefined);
  const paused = action === "pause";
  if (row.paused !== paused)
    await db.execute(sql`
    UPDATE email_accounts SET paused=${paused},connection_generation=connection_generation+1,updated_at=now() WHERE id=${row.id}
  `);
  return ok(undefined);
}

async function enqueueMutation(
  action: MailboxConnectionMutation,
  accountId: string,
  enqueue: EnqueueSync | null,
  signal: AbortSignal,
): Promise<MailboxConnectionResult<void>> {
  if (action !== "retry" && action !== "resume") return ok(undefined);
  if (enqueue === null) return ok(undefined);
  try {
    const queued = await enqueue(accountId, signal);
    return action === "retry" && !queued ? err("network") : ok(undefined);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return action === "retry" ? err("network") : ok(undefined);
  }
}

export async function mutateMailboxConnection(
  db: Db,
  context: MailboxActorSession,
  raw: unknown,
  signal: AbortSignal,
  deps: MutationDependencies = {},
): Promise<MailboxConnectionResult<void>> {
  const parsed = mutationSchema.safeParse(raw);
  if (!parsed.success) return err("invalid_input");
  const { accountId, action } = parsed.data;
  const enqueue = deps.enqueueSync === undefined ? availableQueue() : deps.enqueueSync;
  const changed = await db.transaction(async (tx): Promise<MailboxConnectionResult<void>> => {
    if (!(await lockMailboxSession(tx, context, signal))) return err("permission");
    const row = (
      await tx.execute(sql`
      SELECT id,status,paused,capabilities->'send'='true'::jsonb AS can_send FROM email_accounts
      WHERE id=${accountId} AND user_id=${context.actorId} FOR NO KEY UPDATE
    `)
    ).rows[0] as OwnedMailbox | undefined;
    if (row === undefined) return err("permission");
    if (action !== "disconnect" && row.status === "disconnected") return err("connection_changed");
    if (action === "retry" && row.paused) return err("connection_changed");
    if (action === "retry" && enqueue === null) return err("network");
    const applied = await applyMutation(tx, context.actorId, row, action, signal);
    if (!applied.ok) return applied;
    await recordSecurityEvent(
      tx,
      {
        actorId: context.actorId,
        targetUserId: context.actorId,
        action: `mailbox.${action}`,
        outcome: "success",
        metadata: { accountId },
      },
      signal,
    );
    signal.throwIfAborted();
    return ok(undefined);
  });
  return changed.ok ? enqueueMutation(action, accountId, enqueue, signal) : changed;
}

// The legacy server action remains a thin native-session adapter, not a second
// authority path based on an older CRM actor or a client-provided identity.
export async function disconnectMailboxWithNativeSession(
  db: Db,
  headers: Headers,
  accountId: string,
  signal: AbortSignal,
): Promise<MailboxConnectionResult<void>> {
  const current = await resolveWorkflowSession(db, headers, signal, { requireFresh: true });
  if (current === null) return err("fresh_auth_required");
  return mutateMailboxConnection(
    db,
    { actorId: current.user.id, sessionId: current.session.id },
    { accountId, action: "disconnect" },
    signal,
  );
}
