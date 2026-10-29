import { redirect } from "next/navigation";
import { getEmailMessages } from "@/features/email/emailMessages.server";
import { parseFolder } from "@/features/email/inboxFolders";
import { createContext } from "@/server/trpc/context";
import { InboxListClient } from "./InboxListClient";

export async function generateMetadata() {
  const E = await getEmailMessages();
  return { title: E.title };
}

// Mailbox presence (for the rail's New email button) is read once in the shared inbox layout, not
// here, so this route only resolves the active folder for the conversation column.
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactNode> {
  const ctx = await createContext();
  if (ctx.actor === null) {
    redirect("/login");
  }
  const sp = await searchParams;
  const folder = parseFolder(typeof sp.folder === "string" ? sp.folder : undefined);
  return <InboxListClient selfActorId={ctx.actor.id} folder={folder} />;
}
