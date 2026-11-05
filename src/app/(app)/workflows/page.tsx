import Link from "next/link";
import { messagesForLocale } from "@/features/i18n/catalog";
import { getLocalePreferences } from "@/features/i18n/server";
import { canWorkflow } from "@/features/workflows/access";
import { sanitizeLibraryReturnTo } from "@/features/workflows/ui/libraryLocation";
import { WorkflowLibrary } from "@/features/workflows/ui/WorkflowLibrary";
import { UnifiedWorkflowLibrary } from "@/features/workflows/v2/ui/UnifiedWorkflowLibrary";
import { createContext } from "@/server/trpc/context";

export async function generateMetadata() {
  return { title: messagesForLocale((await getLocalePreferences()).locale).workflows.title };
}
export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await createContext();
  const messages = messagesForLocale((await getLocalePreferences()).locale).workflows;
  if (ctx.actor === null || !canWorkflow(ctx.actor, "view"))
    return <p role="alert">{messages.denied}</p>;
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") query.append(key, value);
    else if (value !== undefined) for (const item of value) query.append(key, item);
  }
  if (search.engine === "legacy")
    return (
      <div className="space-y-4">
        <Link href="/workflows" className="text-xs text-link">
          {messages.title}
        </Link>
        <WorkflowLibrary
          canCreate={false}
          allowNew={false}
          initialLocation={sanitizeLibraryReturnTo(`/workflows?${query}`)}
        />
      </div>
    );
  return (
    <UnifiedWorkflowLibrary
      canCreate={canWorkflow(ctx.actor, "create")}
      initialLocation={sanitizeLibraryReturnTo(`/workflows?${query}`)}
    />
  );
}
