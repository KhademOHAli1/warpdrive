"use client";

import { CircleHelp, LockKeyhole } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { connectSlackAction } from "./actions";
import type { Integration } from "./catalog";
import { IntegrationMark } from "./IntegrationMark";
import { McpSetup } from "./McpSetup";
import { ProviderSummary } from "./ProviderSummary";
import { SlackServerSetup } from "./SlackServerSetup";

export function IntegrationDetails({
  integration,
  endpoint,
  serverOrigin,
  slackConfigured,
  isAdmin,
  gmailControls,
  gmailConfigured,
  returnFocus,
  onClose,
}: {
  integration: Integration;
  endpoint: string | null;
  serverOrigin?: string;
  slackConfigured: boolean;
  isAdmin: boolean;
  gmailControls: ReactNode;
  gmailConfigured: boolean;
  returnFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useAppTranslations("integrations");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"freshAuthentication" | "requestFailed" | null>(null);
  async function connectSlack() {
    setPending(true);
    setError(null);
    try {
      const result = await connectSlackAction(readCsrfToken());
      if (result.ok) window.location.assign(result.value.url);
      else
        setError(result.error === "freshAuthentication" ? "freshAuthentication" : "requestFailed");
    } catch {
      setError("requestFailed");
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
        className="max-h-[88dvh] gap-0 overflow-y-auto p-0 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogHeader className="border-b p-5 text-start sm:p-6">
          <div className="flex items-center gap-3.5 pe-6">
            <IntegrationMark integration={integration} />
            <div>
              <DialogTitle className="text-lg">
                <bdi>{integration.name}</bdi>
              </DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(integration.category === "ai" ? "aiCategory" : integration.category)}
              </p>
            </div>
          </div>
          <DialogDescription className="mt-4 text-sm leading-relaxed">
            {t(integration.descriptionKey)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 p-5 sm:p-6">
          {integration.delivery === "mcp" && (
            <McpSetup endpoint={endpoint} initialClient={integration.id} compact />
          )}
          {integration.delivery === "gmail" && (
            <>
              <ProviderSummary provider="gmail" />
              {gmailConfigured ? (
                gmailControls
              ) : (
                <p
                  role="status"
                  className="rounded-xl bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground"
                >
                  {t("gmailSetup")}
                </p>
              )}
            </>
          )}
          {integration.delivery === "slack" && (
            <>
              <ProviderSummary provider="slack" />
              <p className="text-sm leading-relaxed text-muted-foreground">{t("slackIntro")}</p>
              {!slackConfigured && (
                <p className="flex items-start gap-2 rounded-xl bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
                  <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t("slackSetup")}
                </p>
              )}
              {!slackConfigured && isAdmin && serverOrigin !== undefined && (
                <SlackServerSetup serverOrigin={serverOrigin} />
              )}
              {!isAdmin && (
                <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {t("adminRequired")}
                </p>
              )}
              {error !== null && (
                <p role="alert" className="text-sm text-destructive">
                  {t(error)}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <span className="text-xs text-muted-foreground">{t("slackConnectHint")}</span>
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
            </>
          )}
          {integration.delivery === "planned" && (
            <div className="space-y-3 rounded-xl border border-dashed p-5">
              <p className="text-xs font-semibold text-muted-foreground">{t("planned")}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{t("comingSoon")}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
