import type { ReactNode } from "react";
import { authScreensMessagesForLocale } from "@/features/auth/authScreensMessages";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { getLocalePreferences } from "@/features/i18n/server";
export async function generateMetadata() {
  return { title: authScreensMessagesForLocale((await getLocalePreferences()).locale).pageTitle };
}
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string | string[] }>;
}): Promise<ReactNode> {
  const query = await searchParams;
  // Only the callback's allow-listed display flag is interpreted; arbitrary URL values are never rendered.
  return <LoginScreen failed={query?.error === "auth_failed"} />;
}
