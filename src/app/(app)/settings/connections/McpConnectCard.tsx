"use client";

import { Bot } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";

export function McpConnectCard({ endpointUrl }: { endpointUrl: string }): React.ReactNode {
  const L = useSettingsMessages();
  const S = L;

  const inputId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const copying = useRef(false);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy(): Promise<void> {
    if (copying.current) return;
    copying.current = true;
    setPending(true);
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(endpointUrl);
      setCopied(true);
    } catch {
      setCopyFailed(true);
      field.current?.focus();
      field.current?.select();
    } finally {
      copying.current = false;
      setPending(false);
    }
  }

  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<Bot className="size-4" aria-hidden="true" />}
        title={S.mcpConnectTitle}
        description={S.mcpConnectDescription}
      />
      <SettingsCardBody className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium">
            {S.mcpConnectServerUrl}
          </label>
          <div className="flex flex-col items-start gap-2 sm:flex-row">
            <Textarea
              ref={field}
              id={inputId}
              readOnly
              dir="ltr"
              rows={2}
              value={endpointUrl}
              className="min-w-0 resize-none text-left font-mono text-xs [overflow-wrap:anywhere]"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" variant="outline" disabled={pending} onClick={() => void copy()}>
              {copied ? S.mcpConnectCopied : S.mcpConnectCopy}
            </Button>
          </div>
          {copyFailed && (
            <p role="alert" className="text-sm text-destructive">
              {L._extra.connectionJourney.copyFailed}
            </p>
          )}
          {copied && (
            <p role="status" className="text-xs text-muted-foreground">
              {S.mcpConnectCopied}
            </p>
          )}
        </div>
        <div>
          <p className="text-sm font-medium">{S.mcpConnectStepsHeading}</p>
          <ol className="mt-1.5 list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
            {S.mcpConnectSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <p className="text-sm text-muted-foreground">
          <a
            href={S.mcpConnectDocsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            {S.mcpConnectDocsLink}
          </a>
        </p>
      </SettingsCardBody>
    </SettingsCard>
  );
}
