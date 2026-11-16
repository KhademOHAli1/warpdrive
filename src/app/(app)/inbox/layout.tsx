import { redirect } from "next/navigation";
import type React from "react";
import { createContext } from "@/frontend/context";
import { getActorMailbox } from "@/frontend/reads";
import { InboxShell } from "./InboxShell";

// Persistent inbox layout: it wraps the list, reader (/inbox/[threadId]), and compose (/inbox/
// compose) routes in one shell so the folder rail never remounts as you move between them. Mailbox
// presence (does New email navigate or sit disabled) is read once here rather than per child route.
export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactNode> {
  const ctx = await createContext();
  if (ctx.actor === null) {
    redirect("/login");
  }
  const mailbox = await getActorMailbox();
  return <InboxShell newEmailEnabled={mailbox !== null}>{children}</InboxShell>;
}
