import { err, ok } from "@/types/result";
import type { ImapThreadOperation } from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";

export async function imapMoveTarget(
  runtime: ImapConnectionRuntime,
  operation: Exclude<ImapThreadOperation, { kind: "read" }>,
  signal: AbortSignal,
) {
  const listed = await runtime.imap.listFolders({ signal });
  if (!listed.ok) return listed;
  if (!listed.value.canMove) return err({ kind: "unsupported" } as const);
  const targets = listed.value.folders.filter(
    (folder) =>
      folder.selectable &&
      (operation.kind === "trash"
        ? folder.authoritativeSpecialUse && folder.specialUse === "\\Trash"
        : folder.path === operation.destinationPath),
  );
  const target = targets[0];
  if (target === undefined || targets.length !== 1) return err({ kind: "unsupported" } as const);
  if (
    operation.kind === "move" &&
    target.authoritativeSpecialUse &&
    (target.specialUse === "\\Trash" || target.specialUse === "\\Junk")
  )
    return err({ kind: "unsupported" } as const);
  const inspected = await runtime.imap.inspectFolder({ path: target.path, signal });
  if (!inspected.ok) return inspected;
  if (inspected.value.readOnly) return err({ kind: "read_only" } as const);
  return ok({
    path: target.path,
    uidValidity: inspected.value.uidValidity,
    trash: operation.kind === "trash",
    active: operation.kind !== "trash" && runtime.folderPaths.includes(target.path),
  });
}
export type ImapMoveTarget = Extract<
  Awaited<ReturnType<typeof imapMoveTarget>>,
  { ok: true }
>["value"];
