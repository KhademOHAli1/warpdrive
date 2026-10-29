import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { db } from "@/db/client";
import { settings } from "@/db/schema/system";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/server/trpc/context";
import { CompanyGeneralClient } from "./CompanyGeneralClient";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.companyGeneral };
}

// Company settings > General tab. The tab strip lives in company/layout.tsx, so this page renders
// only the General content (no extra heading). Admin-gated like the other company catalog pages.
export default async function CompanyGeneralPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const { actor } = await createContext();
  if (actor === null || (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.MANAGE))) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }

  const [row] = await db
    .select({ companyName: settings.companyName, baseCurrency: settings.baseCurrency })
    .from(settings)
    .where(eq(settings.id, true));

  return (
    <CompanyGeneralClient
      companyName={row?.companyName ?? ""}
      baseCurrency={row?.baseCurrency ?? "USD"}
    />
  );
}
