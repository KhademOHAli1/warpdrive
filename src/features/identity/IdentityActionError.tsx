"use client";
import Link from "next/link";
import { managementMessagesForLocale } from "@/features/auth/management/messages";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "./useSettingsMessages";
export function IdentityActionError({
  message,
  className = "text-sm text-destructive",
}: {
  message: string;
  className?: string;
}) {
  const L = useSettingsMessages();
  const M = managementMessagesForLocale(useLocale());
  const fresh = message === "fresh_auth_required" || message === L._errors.freshAuthentication;
  return (
    <span role="alert" className={className}>
      <span>{fresh ? L._errors.freshAuthentication : message}</span>
      {fresh && (
        <Link href="/settings/security" className="ms-2 underline">
          {M.securitySettings}
        </Link>
      )}
    </span>
  );
}
