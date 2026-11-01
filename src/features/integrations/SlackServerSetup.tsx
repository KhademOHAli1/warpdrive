import { ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function SlackServerSetup({ serverOrigin }: { serverOrigin: string }) {
  const t = useAppTranslations("integrations");
  return (
    <Collapsible className="rounded-xl border">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-between gap-3 px-4 py-3 text-start"
        >
          {t("serverSetup")}
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t p-4">
        <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-muted-foreground">
          {(
            ["slackSetupStep1", "slackSetupStep2", "slackSetupStep3", "slackSetupStep4"] as const
          ).map((step) => (
            <li key={step}>{t(step)}</li>
          ))}
        </ol>
        <div className="space-y-2">
          <label htmlFor="slack-callback-url" className="block text-xs font-medium">
            {t("slackCallback")}
          </label>
          <Input
            id="slack-callback-url"
            dir="ltr"
            readOnly
            value={`${serverOrigin.replace(/\/$/, "")}/api/integrations/slack/callback`}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
          />
        </div>
        <a
          href="https://api.slack.com/apps"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("slackApps")}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </CollapsibleContent>
    </Collapsible>
  );
}
