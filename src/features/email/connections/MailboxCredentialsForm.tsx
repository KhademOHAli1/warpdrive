"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { MailboxEndpointFields } from "./MailboxEndpointFields";
import { mailboxConnectionMessages } from "./messages";
import { endpointInput, initialEndpoint } from "./model";
import type {
  CheckedMailboxConnection,
  MailboxConnectionActions,
  MailboxConnectionView,
} from "./types";
import { MailboxConnectionFeedback, useMailboxConnectionTask } from "./useMailboxConnectionTask";

export function MailboxCredentialsForm({
  actions,
  existing,
  initialAddress,
  onChecked,
  onRequireFreshAuth,
}: {
  actions: MailboxConnectionActions;
  existing?: MailboxConnectionView;
  initialAddress?: string;
  onChecked: (result: CheckedMailboxConnection) => void;
  onRequireFreshAuth?: () => void;
}) {
  const id = useId();
  const L = mailboxConnectionMessages(useLocale());
  const [email, setEmail] = useState(existing?.emailAddress ?? initialAddress ?? "");
  const [name, setName] = useState(existing?.displayName ?? "");
  const [imap, setImap] = useState(() => initialEndpoint("imap", existing?.configuration?.imap));
  const [smtp, setSmtp] = useState(() => initialEndpoint("smtp", existing?.configuration?.smtp));
  const [invalid, setInvalid] = useState(false);
  const task = useMailboxConnectionTask();
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const incoming = endpointInput(imap);
        const outgoing = endpointInput(smtp);
        if (!incoming || !outgoing || !email.trim()) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        void task.run(
          (signal) =>
            actions.check(
              {
                ...(existing === undefined ? {} : { accountId: existing.id }),
                emailAddress: email,
                displayName: name,
                imap: incoming,
                smtp: outgoing,
              },
              signal,
            ),
          onChecked,
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor={`${id}-email`} className="block space-y-1.5 text-sm">
          <span className="font-medium">{L.email}</span>
          <Input
            id={`${id}-email`}
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            readOnly={existing !== undefined}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={task.busy}
            required
            aria-describedby={`${id}-email-help`}
          />
        </label>
        <label htmlFor={`${id}-name`} className="block space-y-1.5 text-sm">
          <span className="font-medium">{L.displayName}</span>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={task.busy}
            autoComplete="name"
          />
        </label>
      </div>
      <p id={`${id}-email-help`} className="text-xs leading-relaxed text-muted-foreground">
        {L.emailHelp}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <MailboxEndpointFields kind="imap" value={imap} onChange={setImap} disabled={task.busy} />
        <MailboxEndpointFields kind="smtp" value={smtp} onChange={setSmtp} disabled={task.busy} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{L.credentialHelp}</p>
      <p className="text-sm text-muted-foreground">{L.noTestSend}</p>
      <MailboxConnectionFeedback
        error={invalid ? "invalid_input" : task.error}
        onRequireFreshAuth={onRequireFreshAuth}
        onBeforeFreshAuth={() => {
          setImap((current) => ({ ...current, password: "" }));
          setSmtp((current) => ({ ...current, password: "" }));
        }}
      />
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={task.busy}>
          {task.busy ? L.checking : L.check}
        </Button>
      </div>
      {task.busy && (
        <p role="status" className="sr-only">
          {L.checking}
        </p>
      )}
    </form>
  );
}
