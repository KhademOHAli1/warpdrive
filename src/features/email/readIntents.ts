import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { runImapThreadOperation } from "./imapThreadOperations";
import type { ImapThreadOperationDeps } from "./imapThreadOperationsTypes";
import { admitThreadReadIntent } from "./readIntentExecution";
import type { ReadIntentActor } from "./readIntentLifecycle";
import type { ReadActionValue } from "./readIntentTypes";

export async function executeThreadReadIntent(
  db: Db,
  args: ReadIntentActor & { threadId: string; operationId: string; read: boolean },
  signal: AbortSignal,
  deps: ImapThreadOperationDeps = {},
): Promise<Result<ReadActionValue, AppError>> {
  const admitted = await admitThreadReadIntent(db, args, signal);
  if (admitted.kind === "settled") return admitted.result;
  // No credentials or provider operation are reached until the admission's
  // owning COMMIT acknowledgement has completed. A lost claim receipt stops here.
  const result = await runImapThreadOperation(
    db,
    {
      actor: admitted.actor,
      threadId: args.threadId,
      operation: { kind: "read", read: args.read },
    },
    signal,
    { ...deps, readIntent: admitted },
  );
  if (!result.ok) return result;
  if (result.value.readIntent?.state !== "applied")
    return err(new AppError(ERROR_IDS.MAIL_WRITE_UNKNOWN, "Read receipt not confirmed"));
  return ok({ threadId: args.threadId, readIntent: result.value.readIntent });
}
