import { redirect } from "next/navigation";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { createContext } from "@/frontend/context";
import { CompanyGeneralClient } from "./CompanyGeneralClient";
export async function generateMetadata() {
  return { title: (await getServerSettingsMessages()).companyGeneral };
}
export default async function CompanyGeneralPage() {
  const { actor } = await createContext();
  if (actor === null) redirect("/login");
  return <CompanyGeneralClient actorId={actor.id} />;
}
