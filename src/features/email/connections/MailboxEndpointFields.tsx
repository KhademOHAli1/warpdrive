"use client";

import { useId } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { mailboxConnectionMessages } from "./messages";
import type { EndpointDraft } from "./model";

export function MailboxEndpointFields({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: "imap" | "smtp";
  value: EndpointDraft;
  onChange: (value: EndpointDraft) => void;
  disabled: boolean;
}) {
  const id = useId();
  const L = mailboxConnectionMessages(useLocale());
  const incoming = kind === "imap";
  const fields = [
    { key: "host", label: incoming ? L.imapHost : L.smtpHost, type: "text", autoComplete: "off" },
    {
      key: "username",
      label: incoming ? L.imapUser : L.smtpUser,
      type: "text",
      autoComplete: "username",
    },
    {
      key: "password",
      label: incoming ? L.imapPassword : L.smtpPassword,
      type: "password",
      autoComplete: "new-password",
    },
  ] as const;
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border bg-muted/10 p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{incoming ? L.receiving : L.sending}</legend>
      {fields.map((field) => (
        <label key={field.key} htmlFor={`${id}-${field.key}`} className="block space-y-1.5 text-sm">
          <span>{field.label}</span>
          <Input
            id={`${id}-${field.key}`}
            type={field.type}
            dir="ltr"
            autoComplete={field.autoComplete}
            autoCapitalize="none"
            spellCheck={false}
            value={value[field.key]}
            onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
            required
          />
        </label>
      ))}
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
        <label htmlFor={`${id}-port`} className="block space-y-1.5 text-sm">
          <span>{L.port}</span>
          <Input
            id={`${id}-port`}
            dir="ltr"
            inputMode="numeric"
            value={value.port}
            onChange={(event) => onChange({ ...value, port: event.target.value })}
            required
          />
        </label>
        <div className="space-y-1.5 text-sm">
          <span>{L.security}</span>
          <Select
            ariaLabel={`${incoming ? L.receiving : L.sending}: ${L.security}`}
            value={value.security}
            disabled={disabled}
            options={[
              { value: "tls", label: L.tls },
              { value: "starttls", label: L.starttls },
            ]}
            onChange={(security) => {
              if (security === "tls" || security === "starttls") onChange({ ...value, security });
            }}
          />
        </div>
      </div>
    </fieldset>
  );
}
