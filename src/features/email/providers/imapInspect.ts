import type { ImapFlow } from "imapflow";
import { err, ok, type Result } from "@/types/result";
import { fetchSingleImapMessage } from "./imapFetchOne";
import type { ImapFailure, ImapMutationArgs } from "./imapTypes";

export interface ImapMessageInspection {
  messages: { uid: number; flags: string[] }[];
  missing: number[];
}

export async function inspectImapMessages(
  client: ImapFlow,
  args: ImapMutationArgs,
): Promise<Result<ImapMessageInspection, ImapFailure>> {
  if (client.mailbox === false) return err({ kind: "mailbox_missing" });
  if (client.mailbox.uidValidity.toString() !== args.uidValidity)
    return err({ kind: "uidvalidity_changed" });
  const value: ImapMessageInspection = { messages: [], missing: [] };
  for (const uid of args.uids) {
    const inspected = await fetchSingleImapMessage(
      client,
      uid,
      { uid: true, flags: true },
      args.signal,
    );
    args.signal.throwIfAborted();
    if (!inspected.ok) return inspected;
    const fetched = inspected.value;
    if (fetched === null) value.missing.push(uid);
    else {
      value.messages.push({ uid, flags: [...(fetched.flags ?? [])] });
    }
  }
  if (client.mailbox.uidValidity.toString() !== args.uidValidity)
    return err({ kind: "uidvalidity_changed" });
  return ok(value);
}
