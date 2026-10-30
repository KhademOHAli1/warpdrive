import { redirect } from "next/navigation";
import { getEmailMessages } from "@/features/email/emailMessages.server";
import { parseFolder } from "@/features/email/inboxFolders";

export async function generateMetadata() {
  return { title: (await getEmailMessages()).title };
}
export default async function InboxThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const { threadId } = await params;
  const search = await searchParams;
  const folder = parseFolder(typeof search.folder === "string" ? search.folder : undefined);
  redirect(`/inbox?${new URLSearchParams({ folder, thread: threadId }).toString()}`);
}
