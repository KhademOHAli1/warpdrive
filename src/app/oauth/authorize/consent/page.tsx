import { notFound, redirect } from "next/navigation";
import { coreClient } from "@/frontend/trpc";
import { Consent } from "../consent";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OAuthConsentPage({
  searchParams,
}: PageProps): Promise<React.ReactNode> {
  const result = await coreClient().frontend.oauthConsent.query(await searchParams);
  if (result.kind === "notfound") notFound();
  if (result.kind === "redirect") redirect(result.url);
  return (
    <Consent
      action={result.action}
      clientName={result.clientName}
      redirectUri={result.redirectUri}
    />
  );
}
