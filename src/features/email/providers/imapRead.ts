import type { ImapFlow, MailboxObject } from "imapflow";
import { err, ok, type Result } from "@/types/result";
import { fetchImapEntry } from "./imapFetch";
import { IMAP_LIMITS, type ImapFailure, type ImapFolderPage, type ImapReadArgs } from "./imapTypes";

const MAX_IMAP_UID = 4_294_967_295;

export function validImapUid(uid: number): boolean {
  return Number.isSafeInteger(uid) && uid > 0 && uid <= MAX_IMAP_UID;
}

function initialPage(mailbox: MailboxObject, args: ImapReadArgs): ImapFolderPage {
  return {
    path: args.path,
    uidValidity: mailbox.uidValidity.toString(),
    uidNext: mailbox.uidNext,
    readOnly: mailbox.readOnly === true,
    messageCount: mailbox.exists,
    lastUid: args.afterUid ?? 0,
    nextAfterUid: null,
    hasMore: false,
    messages: [],
    skipped: [],
  };
}

function sameValidity(client: ImapFlow, expected: string): boolean {
  return client.mailbox !== false && client.mailbox.uidValidity.toString() === expected;
}

export async function readImapFolder(
  client: ImapFlow,
  args: ImapReadArgs,
): Promise<Result<ImapFolderPage, ImapFailure>> {
  if (client.mailbox === false) return err({ kind: "mailbox_missing" });
  const page = initialPage(client.mailbox, args);
  const after = args.afterUid ?? 0;
  const highest = Math.min(MAX_IMAP_UID, page.uidNext - 1);
  if (after >= highest) return ok(page);
  // At most 4096 ten-digit UIDs fit below the bounded protocol line limit.
  const windowEnd = Math.min(highest, after + IMAP_LIMITS.searchUidWindow);
  const found = await client.search(
    {
      uid: `${after + 1}:${windowEnd}`,
      ...(args.since === undefined ? {} : { since: args.since }),
    },
    { uid: true },
  );
  args.signal.throwIfAborted();
  if (!Array.isArray(found)) return err({ kind: "protocol" });
  const uids = [
    ...new Set(found.filter((uid) => uid > after && uid <= windowEnd && validImapUid(uid))),
  ].sort((a, b) => a - b);
  let bytes = 0;
  let consumed = 0;
  for (const uid of uids.slice(0, args.limit ?? IMAP_LIMITS.pageMessages)) {
    const entry = await fetchImapEntry(client, uid, IMAP_LIMITS.batchBytes - bytes, args.signal);
    if (!entry.ok) return entry;
    if (entry.value.state === "batch_full") break;
    if (entry.value.state === "skipped") page.skipped.push({ uid, reason: entry.value.reason });
    else {
      page.messages.push(entry.value.message);
      bytes += entry.value.message.source.length;
    }
    page.lastUid = uid;
    consumed += 1;
  }
  if (!sameValidity(client, page.uidValidity)) return err({ kind: "uidvalidity_changed" });
  // Fully scanned empty/old ranges must advance, or sparse folders would loop forever.
  if (consumed === uids.length) page.lastUid = windowEnd;
  page.hasMore = consumed < uids.length || windowEnd < highest;
  page.nextAfterUid = page.hasMore ? page.lastUid : null;
  return ok(page);
}
