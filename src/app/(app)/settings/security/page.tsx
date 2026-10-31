import { authScreensMessagesForLocale } from "@/features/auth/authScreensMessages";
import { SecuritySettings } from "@/features/auth/ui/SecuritySettings";
import { getLocalePreferences } from "@/features/i18n/server";

export async function generateMetadata() {
  return {
    title: authScreensMessagesForLocale((await getLocalePreferences()).locale).flow.securityTitle,
  };
}
export default function SecurityPage() {
  return <SecuritySettings />;
}
