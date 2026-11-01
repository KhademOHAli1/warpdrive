import { getLocalePreferences } from "@/features/i18n/server";
import { privacyRequestMessagesForLocale } from "@/features/privacy/privacyRequestMessages";
import { PersonalPrivacyWorkspace } from "@/features/privacy/ui/PersonalPrivacyWorkspace";

export async function generateMetadata() {
  return {
    title: privacyRequestMessagesForLocale((await getLocalePreferences()).locale).workspaceTitle,
  };
}

export default function PrivacyPage() {
  return <PersonalPrivacyWorkspace />;
}
