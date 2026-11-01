"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { INTEGRATIONS } from "./catalog";
import { IntegrationMark } from "./IntegrationMark";
import { McpWorkflowExamples } from "./McpWorkflowExamples";

const clients = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    guide: "https://developers.openai.com/plugins",
    steps: ["chatgptStep1", "chatgptStep2", "chatgptStep3"],
  },
  {
    id: "claude",
    label: "Claude",
    guide:
      "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    steps: ["claudeStep1", "claudeStep2", "claudeStep3"],
  },
  {
    id: "other-mcp",
    label: "MCP",
    guide: "https://modelcontextprotocol.io/docs/getting-started/intro",
    steps: ["otherStep1", "otherStep2", "otherStep3"],
  },
] as const;

export function McpSetup({
  endpoint,
  initialClient = "chatgpt",
  compact = false,
}: {
  endpoint: string | null;
  initialClient?: string;
  compact?: boolean;
}) {
  const t = useAppTranslations("integrations");
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    if (endpoint === null) return;
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div
      className={
        compact ? "@container space-y-5" : "@container space-y-5 rounded-xl border bg-card p-5"
      }
    >
      {!compact && (
        <div>
          <h2 className="text-base font-semibold">{t("mcpTitle")}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t("mcpBody")}</p>
        </div>
      )}
      <McpWorkflowExamples compact={compact} />
      {endpoint !== null ? (
        <div className="space-y-2">
          <label htmlFor={id} className="text-sm font-medium">
            {t("mcpUrl")}
          </label>
          <div className="flex gap-2">
            <Input
              id={id}
              value={endpoint}
              readOnly
              dir="ltr"
              className="min-w-0 font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                void copy();
              }}
            >
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
          {copyError && (
            <p role="alert" className="text-sm text-destructive">
              {t("copyFailed")}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">{t("publicEndpoint")}</p>
        </div>
      ) : (
        <p
          role="status"
          className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm leading-relaxed text-muted-foreground"
        >
          {t("mcpDisabled")}
        </p>
      )}
      <Tabs defaultValue={initialClient}>
        <TabsList
          className="flex-wrap gap-1 group-data-horizontal/tabs:h-auto"
          aria-label={t("ai")}
        >
          {clients.map((client) => (
            <TabsTrigger
              key={client.id}
              value={client.id}
              className={`${PILL_TAB} h-auto gap-2 px-3 py-2`}
            >
              {INTEGRATIONS.filter((item) => item.id === client.id).map((item) => (
                <IntegrationMark key={item.id} integration={item} compact />
              ))}
              {client.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {clients.map((client) => (
          <TabsContent key={client.id} value={client.id} className="mt-4 space-y-4">
            <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-muted-foreground">
              {client.steps.map((step) => (
                <li key={step}>{t(step)}</li>
              ))}
            </ol>
            <a
              href={client.guide}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("learn")}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </TabsContent>
        ))}
      </Tabs>
      <p className="flex items-start gap-2 border-t pt-4 text-sm leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {t("mcpAccess")}
          <span className="mt-2 block">{t("currentGrant")}</span>
        </span>
      </p>
    </div>
  );
}
