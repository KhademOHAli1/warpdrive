import type { Metadata } from "next";
import type React from "react";
import { getAppTranslations } from "@/features/i18n/server";
import { entityTitle } from "@/features/navigation/pageTitle";
import { loadPerson, PersonDetailView } from "./PersonDetailView";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ personId: string }>;
}): Promise<Metadata> {
  const t = await getAppTranslations("contacts");
  const { personId } = await params;
  const loaded = await loadPerson(personId);
  const name = loaded.kind === "ok" ? loaded.value.name : null;
  return { title: entityTitle(name, t("personFallback")) };
}

export default async function PersonPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}): Promise<React.ReactNode> {
  const { personId } = await params;
  return <PersonDetailView personId={personId} />;
}
