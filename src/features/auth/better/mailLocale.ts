import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { userPreferences } from "@/db/schema";
import { LOCALE_COOKIE } from "@/features/i18n/preferences";
import { parseLocale } from "@/features/i18n/registry";
import { uiSchema } from "@/features/identity/preferencesSchema";
import { readCookie } from "./sessionToken";

export async function authMailLocale(db: Db, userId: string, request?: Request) {
  const cookie = request ? readCookie(request.headers, LOCALE_COOKIE) : null;
  if (cookie === "fa" || cookie === "de" || cookie === "en") return parseLocale(cookie);
  const [row] = await db
    .select({ ui: userPreferences.ui })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  const parsed = uiSchema.safeParse(row?.ui ?? {});
  return parsed.success ? (parsed.data.localePreferences?.locale ?? "en") : "en";
}
