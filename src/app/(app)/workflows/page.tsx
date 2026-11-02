import { messagesForLocale } from "@/features/i18n/catalog";
import { getLocalePreferences } from "@/features/i18n/server";
import { canWorkflow } from "@/features/workflows/access";
import { WorkflowLibrary } from "@/features/workflows/ui/WorkflowLibrary";
import { createContext } from "@/server/trpc/context";

export async function generateMetadata() {
  return { title: messagesForLocale((await getLocalePreferences()).locale).workflows.title };
}
export default async function WorkflowsPage() {
  const ctx = await createContext();
  const messages = messagesForLocale((await getLocalePreferences()).locale).workflows;
  if (ctx.actor === null || !canWorkflow(ctx.actor, "view"))
    return <p role="alert">{messages.denied}</p>;
  return <WorkflowLibrary canCreate={canWorkflow(ctx.actor, "create")} />;
}
