import { TRPCClientError } from "@trpc/client";
import { notFound, redirect } from "next/navigation";
import { getLocalePreferences } from "@/features/i18n/server";
import { operationsAccessMessages } from "@/features/operations-access/ui/messages";
import { OperationsAccessPanel } from "@/features/operations-access/ui/OperationsAccessPanel";
import { createContext } from "@/frontend/context";
import { coreClient } from "@/frontend/trpc";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";

export async function generateMetadata() {
  const { locale } = await getLocalePreferences();
  return { title: operationsAccessMessages[locale].title };
}

export default async function OperationsAccessPage() {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  if (actor.type !== "admin" || !actor.isActive) notFound();

  const { locale } = await getLocalePreferences();
  const t = operationsAccessMessages[locale];
  const result = await coreClient()
    .operationsAccess.workspace.query()
    .catch((error: unknown) => {
      if (!(error instanceof TRPCClientError)) throw error;
      return { ok: false, error: "unavailable" } as const;
    });

  return (
    <SettingsPage className="max-w-3xl">
      <SettingsHeading scope="workspace" title={t.title} description={t.description} />
      <OperationsAccessPanel key={actor.id} actorId={actor.id} initial={result} />
    </SettingsPage>
  );
}
