"use client";
import { ArrowUpRight, CircleHelp, LockKeyhole, Plug, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { type RefObject, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { connectSlackAction } from "./actions";
import type { Integration } from "./catalog";
import { IntegrationMark } from "./IntegrationMark";
import { McpSetup } from "./McpSetup";

export function IntegrationDetails({
  integration,
  name,
  endpoint,
  serverOrigin,
  slackConfigured,
  isAdmin,
  returnFocus,
  onClose,
}: {
  integration: Integration;
  name: string;
  endpoint: string | null;
  serverOrigin?: string;
  slackConfigured: boolean;
  isAdmin: boolean;
  returnFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useAppTranslations("integrations");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function connectSlack() {
    setPending(true);
    setError(false);
    try {
      const result = await connectSlackAction(readCsrfToken());
      if (result.ok) window.location.assign(result.value.url);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogHeader>
          <IntegrationMark integration={integration} />
          <DialogTitle className="pt-3">
            <bdi>{name}</bdi>
          </DialogTitle>
          <DialogDescription>{t(`providers.${integration.id}.description`)}</DialogDescription>
        </DialogHeader>
        {integration.delivery === "mcp" && (
          <McpSetup endpoint={endpoint} initialClient={integration.id} compact />
        )}
        {integration.delivery === "gmail" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("gmailBody")}</p>
            <Link className={buttonVariants()} href="/settings/email-sync">
              {t("gmailManage")}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        )}
        {integration.delivery === "slack" && (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-muted-foreground">{t("slackIntro")}</p>
            <div className="rounded-lg border bg-muted/20 p-4">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4" aria-hidden="true" />
                {t("access")}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t("slackAccess")}
              </p>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Plug className="size-4" aria-hidden="true" />
              {t("workspace")}
            </p>
            {!slackConfigured && (
              <p className="flex items-start gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {t("slackSetup")}
              </p>
            )}
            {!slackConfigured && isAdmin && serverOrigin !== undefined && (
              <div className="space-y-3 rounded-lg border p-4">
                <h3 className="text-sm font-medium">{t("slackSetupTitle")}</h3>
                <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-muted-foreground">
                  {(
                    [
                      "slackSetupStep1",
                      "slackSetupStep2",
                      "slackSetupStep3",
                      "slackSetupStep4",
                    ] as const
                  ).map((step) => (
                    <li key={step}>{t(step)}</li>
                  ))}
                </ol>
                <label htmlFor="slack-callback-url" className="block text-sm font-medium">
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
                <a
                  href="https://api.slack.com/apps"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("slackApps")}
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </a>
              </div>
            )}
            {!isAdmin && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
                {t("adminRequired")}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t("requestFailed")}
              </p>
            )}
            <Button
              type="button"
              disabled={!slackConfigured || !isAdmin || pending}
              onClick={() => {
                void connectSlack();
              }}
            >
              {pending ? t("busy") : t("connect")}
            </Button>
          </div>
        )}
        {integration.delivery === "planned" && (
          <p className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed text-muted-foreground">
            <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("comingSoon")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
