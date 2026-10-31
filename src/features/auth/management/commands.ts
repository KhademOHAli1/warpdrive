import type { Db } from "@/db/client";
import {
  assignPermissionSet,
  setUserActive,
  setUserAdmin,
} from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import {
  reviewRecoveryRequest,
  revokeManagedUserAccess,
  transferUserOwnership,
} from "./administration";
import { recordSecurityEvent } from "./audit";
import { issueInvitation, resendInvitation, revokeInvitation } from "./invitations";
import { retryAuthMail } from "./mail";
import { updateAuthPolicy } from "./policy";
import type { ManagementAction } from "./schemas";
import { revokeManagedSession } from "./userDetails";

export async function runManagementCommand(
  db: Db,
  actor: PermSetUser,
  command: ManagementAction,
  signal: AbortSignal,
): Promise<Result<unknown, string>> {
  if (!actor.isActive || (actor.type !== "admin" && !actor.flags.has("permissions.manage")))
    return err("forbidden");
  signal.throwIfAborted();
  switch (command.action) {
    case "invite":
      return issueInvitation(db, actor, command, signal);
    case "resendInvitation":
      return resendInvitation(db, actor, command.id, signal);
    case "revokeInvitation":
      return revokeInvitation(db, actor, command.id, signal);
    case "setActive":
      return setUserActive(db, actor, command, signal);
    case "setAdmin":
      return setUserAdmin(db, actor, command, signal);
    case "setPermissionSet":
      return assignPermissionSet(
        db,
        actor,
        { userId: command.userId, setId: command.setId },
        signal,
      );
    case "revokeAccess":
      return revokeManagedUserAccess(db, actor, command.userId, signal);
    case "revokeManagedSession":
      return revokeManagedSession(db, actor, command.userId, command.sessionId, signal);
    case "transferOwnership":
      return transferUserOwnership(db, actor, command.fromUserId, command.toUserId, signal);
    case "reviewRecovery":
      return reviewRecoveryRequest(db, actor, command.id, command.status, signal);
    case "updatePolicy":
      return updateAuthPolicy(db, actor, command.policy, signal);
    case "retryDelivery":
      if (actor.type !== "admin") return err("forbidden");
      await retryAuthMail(db, command.id, signal);
      await recordSecurityEvent(
        db,
        { actorId: actor.id, action: "mail.retry", outcome: "success" },
        signal,
      );
      return ok(true);
    case "bulkActive": {
      if (actor.type !== "admin") return err("forbidden");
      const results: { userId: string; ok: boolean; error?: string }[] = [];
      for (const userId of [...new Set(command.userIds)]) {
        const result = await setUserActive(
          db,
          actor,
          { userId, isActive: command.isActive },
          signal,
        );
        results.push(result.ok ? { userId, ok: true } : { userId, ok: false, error: result.error });
      }
      return ok({ results });
    }
  }
}
