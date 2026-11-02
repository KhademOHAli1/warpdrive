import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { sendableComposerMailboxes } from "@/features/email/composer/composerMailbox.types";
import { getEmailMessages } from "@/features/email/emailMessages.server";
import { listActorMailboxes } from "@/features/email/mailAccountsRepo";
import { createContext } from "@/server/trpc/context";
import { ComposePageClient } from "./ComposePageClient";

export async function generateMetadata() {
  const E = await getEmailMessages();
  return { title: E.composeTitle };
}

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactNode> {
  const ctx = await createContext();
  if (ctx.actor === null) {
    redirect("/login");
  }
  // Compose is meaningless without a connected mailbox: send back to the inbox rather than
  // rendering a broken pane.
  const mailboxes = (await listActorMailboxes(db, ctx.actor.id, AbortSignal.timeout(8000))).map(
    (mailbox) => ({
      id: mailbox.id,
      emailAddress: mailbox.emailAddress,
      displayName: mailbox.displayName,
      isDefault: mailbox.isDefault,
      status: mailbox.status,
      capabilities: mailbox.capabilities,
    }),
  );
  const senders = sendableComposerMailboxes(mailboxes);
  const mailbox = senders.find((sender) => sender.isDefault) ?? senders[0] ?? mailboxes[0];
  if (mailbox === undefined) {
    redirect("/inbox");
  }
  const sp = await searchParams;
  const draft = typeof sp.draft === "string" ? sp.draft : undefined;
  return (
    <ComposePageClient
      accountId={mailbox.id}
      fromAddress={mailbox.emailAddress}
      mailboxes={mailboxes}
      selfActorId={ctx.actor.id}
      draftId={draft}
    />
  );
}
