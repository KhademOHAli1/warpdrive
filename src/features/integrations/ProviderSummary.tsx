import { Check, ShieldCheck } from "lucide-react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function ProviderSummary({ provider }: { provider: "slack" | "gmail" }) {
  const t = useAppTranslations("integrations");
  const capabilities =
    provider === "slack"
      ? (["slackCapability1", "slackCapability2", "slackCapability3"] as const)
      : (["gmailCapability1", "gmailCapability2", "gmailCapability3"] as const);
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_14rem]">
      <section>
        <h3 className="text-sm font-semibold">{t("capabilities")}</h3>
        <ul className="mt-4 space-y-3">
          {capabilities.map((key) => (
            <li key={key} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
              <Check className="mt-1 size-3.5 shrink-0 text-primary" aria-hidden="true" />
              {t(key)}
            </li>
          ))}
        </ul>
      </section>
      <aside className="rounded-xl bg-muted/40 p-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          {t("access")}
        </h3>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t(provider === "slack" ? "slackAccess" : "gmailAccess")}
        </p>
        <p className="mt-4 border-t pt-3 text-xs font-medium">
          {t(provider === "slack" ? "workspace" : "personal")}
        </p>
      </aside>
    </div>
  );
}
