import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { emailMessages, emailThreads } from "@/db/schema";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { chooseImapThread } from "./imapThreading";
import { resolveLink, resolveOutboundLink } from "./linking";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { RawParsedMail } from "./providers/rawMimeTypes";

const stringArray = z.array(z.string());
function addresses(value: unknown): string[] {
  const parsed = stringArray.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function imapParticipants(parsed: RawParsedMail): string[] {
  return [...new Set([...parsed.from, ...parsed.to, ...parsed.cc].map((address) => address.email))];
}

function referenceOrder(parsed: RawParsedMail): string[] {
  const references = parsed.references.filter((reference) => reference !== parsed.inReplyTo);
  if (parsed.inReplyTo !== null) references.push(parsed.inReplyTo);
  return references.slice(-MAX_THREAD_REFERENCES);
}

async function referencedThread(
  tx: DbOrTx,
  runtime: ImapConnectionRuntime,
  parsed: RawParsedMail,
  signal: AbortSignal,
): Promise<string | null> {
  const references = referenceOrder(parsed);
  if (references.length === 0) return null;
  const candidates = await tx
    .select({
      accountId: emailMessages.accountId,
      threadId: emailMessages.threadId,
      rfcMessageId: emailMessages.rfcMessageId,
      from: emailMessages.fromEmail,
      to: emailMessages.toEmails,
      cc: emailMessages.ccEmails,
    })
    .from(emailMessages)
    .innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
    .where(
      and(
        eq(emailMessages.accountId, runtime.accountId),
        inArray(emailMessages.rfcMessageId, references),
        isNull(emailThreads.remoteTrashedAt),
      ),
    )
    .limit(MAX_THREAD_CANDIDATES);
  signal.throwIfAborted();
  // A truncated set cannot establish that a referenced thread is unambiguous.
  if (candidates.length >= MAX_THREAD_CANDIDATES) return null;
  return chooseImapThread({
    accountId: runtime.accountId,
    ownAddresses: [runtime.emailAddress],
    references,
    participants: imapParticipants(parsed),
    candidates: candidates.flatMap((candidate) =>
      candidate.rfcMessageId === null
        ? []
        : [
            {
              accountId: candidate.accountId,
              threadId: candidate.threadId,
              rfcMessageId: candidate.rfcMessageId,
              participants: [
                candidate.from,
                ...addresses(candidate.to),
                ...addresses(candidate.cc),
              ],
            },
          ],
    ),
  });
}

export async function imapThreadForMessage(
  tx: DbOrTx,
  runtime: ImapConnectionRuntime,
  owner: AuthUser,
  parsed: RawParsedMail,
  date: Date,
  signal: AbortSignal,
): Promise<string> {
  const found = await referencedThread(tx, runtime, parsed, signal);
  if (found !== null) {
    await tx.execute(sql`UPDATE email_threads SET last_message_at=GREATEST(last_message_at,${date}),
      trashed_at=NULL,updated_at=now() WHERE id=${found} AND account_id=${runtime.accountId} AND remote_trashed_at IS NULL`);
    signal.throwIfAborted();
    return found;
  }
  const from = parsed.from[0]?.email ?? "";
  const self = from.toLowerCase() === runtime.emailAddress.toLowerCase();
  const link = self
    ? await resolveOutboundLink(
        tx,
        {
          owner,
          fromEmail: from,
          recipients: [...parsed.to, ...parsed.cc].map((address) => address.email),
        },
        signal,
      )
    : await resolveLink(
        tx,
        {
          owner,
          fromEmail: from,
          participants: imapParticipants(parsed).filter(
            (address) => address.toLowerCase() !== runtime.emailAddress.toLowerCase(),
          ),
        },
        signal,
      );
  const id = randomUUID();
  const [thread] = await tx
    .insert(emailThreads)
    .values({
      id,
      accountId: runtime.accountId,
      providerThreadId: `imap:${id}`,
      subject: parsed.subject,
      personId: link.kind === "linked" ? link.personId : null,
      dealId: link.kind === "linked" ? link.dealId : null,
      lastMessageAt: date,
      visibility: "private",
    })
    .returning({ id: emailThreads.id });
  signal.throwIfAborted();
  if (thread === undefined)
    throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "IMAP thread insert returned no row");
  return thread.id;
}

const MAX_THREAD_REFERENCES = 100;
const MAX_THREAD_CANDIDATES = 200;
