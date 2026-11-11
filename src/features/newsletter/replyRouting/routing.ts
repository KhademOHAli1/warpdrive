import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listActorMailboxes } from "@/features/email/mailAccountsRepo";
import type { Campaign } from "../campaigns/model";
import type { NewsletterExecution } from "../operation";
import {
  managedReplyRouting,
  type ReplyMailbox,
  type RoutedCampaignFields,
  replyRoutingAttribute,
  replyToValues,
  withoutManagedReplyRouting,
  withoutReplyTo,
} from "./contracts";

type Context = Pick<NewsletterExecution, "db" | "actor" | "signal">;
type ReplyFields = Pick<RoutedCampaignFields, "headers" | "attribs" | "replyToMailboxId">;
type SavedCampaign = { headers?: Campaign["headers"]; attribs?: Campaign["attribs"] };

function unavailable() {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Review the connected CRM inbox and Reply-To address before continuing.",
  });
}

const mailboxAddress = z.email().max(254);
export async function listReplyMailboxes({ db, actor, signal }: Context): Promise<ReplyMailbox[]> {
  const rows = await listActorMailboxes(db, actor.id, signal);
  return rows.flatMap((row) => {
    if (
      row.status !== "connected" ||
      !row.capabilities.read ||
      (row.provider === "imap_smtp" &&
        row.folderPaths?.some((path) => path.toUpperCase() === "INBOX") !== true)
    )
      return [];
    const email = mailboxAddress.safeParse(row.emailAddress);
    if (!email.success) return [];
    return [
      {
        id: row.id,
        address: email.data,
        ...(row.displayName === undefined ? {} : { displayName: row.displayName }),
      },
    ];
  });
}

async function requireMailbox(context: Context, mailboxId: string): Promise<ReplyMailbox> {
  const mailbox = (await listReplyMailboxes(context)).find(({ id }) => id === mailboxId);
  if (mailbox === undefined) throw unavailable();
  return mailbox;
}

export async function requireCurrentReplyRouting(context: Context, saved: SavedCampaign) {
  const selected = managedReplyRouting(saved.attribs);
  if (selected.state === "manual") return;
  if (selected.state === "invalid") throw unavailable();
  const mailbox = await requireMailbox(context, selected.mailboxId);
  const values = replyToValues(saved.headers ?? []);
  if (values.length !== 1 || values[0] !== mailbox.address) throw unavailable();
}

export async function campaignReplyRouting(
  context: Context,
  { replyToMailboxId, headers, attribs }: ReplyFields,
  saved: SavedCampaign = {},
): Promise<Pick<ReplyFields, "headers" | "attribs">> {
  if (attribs !== undefined && Object.hasOwn(attribs, replyRoutingAttribute))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose Reply-To through the CRM inbox selector.",
    });
  const previous = managedReplyRouting(saved.attribs);
  if (replyToMailboxId === undefined && previous.state === "invalid") throw unavailable();
  const mailboxId =
    replyToMailboxId === undefined && previous.state === "managed"
      ? previous.mailboxId
      : (replyToMailboxId ?? null);
  if (mailboxId === null) {
    return previous.state === "manual"
      ? { headers, attribs }
      : {
          headers: headers ?? withoutReplyTo(saved.headers ?? []),
          attribs: withoutManagedReplyRouting(attribs ?? saved.attribs),
        };
  }
  const mailbox = await requireMailbox(context, mailboxId);
  const values = replyToValues(
    headers ?? (replyToMailboxId === undefined ? (saved.headers ?? []) : []),
  );
  if (
    (replyToMailboxId === undefined && values.length !== 1) ||
    values.length > 1 ||
    (values.length === 1 && values[0] !== mailbox.address)
  )
    throw unavailable();
  const existing = withoutReplyTo(headers ?? saved.headers ?? []);
  if (existing.length >= 30)
    throw new TRPCError({ code: "BAD_REQUEST", message: "There are too many campaign headers." });
  return {
    headers: [...existing, { "Reply-To": mailbox.address }],
    attribs: {
      ...withoutManagedReplyRouting(attribs ?? saved.attribs),
      [replyRoutingAttribute]: { version: 1, mailboxId },
    },
  };
}
