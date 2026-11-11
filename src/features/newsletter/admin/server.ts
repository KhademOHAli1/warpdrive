import { notFound } from "next/navigation";
import { getLocalePreferences } from "@/features/i18n/server";
import { createContext } from "@/server/trpc/context";
import { adminMessages } from "./messages";

export async function requireNewsletterAdmin() {
  const { actor, session } = await createContext();
  if (actor?.type !== "admin" || !actor.isActive || session === null) notFound();
  return adminMessages((await getLocalePreferences()).locale);
}

export function newsletterMaintenanceDates() {
  const day = 86_400_000;
  const now = Date.now();
  const date = (offset: number) => new Date(now - offset * day).toISOString().slice(0, 10);
  return { today: date(0), weekAgo: date(7), monthAgo: date(30) };
}
