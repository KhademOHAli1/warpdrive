"use client";
import { LockKeyhole } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { type ComposerMailbox, sendableComposerMailboxes } from "./composerMailbox.types";
import { useComposerMailboxMessages } from "./useComposerMailboxMessages";

interface FromPickerProps {
  address: string;
  accountId?: string;
  mailboxes?: ComposerMailbox[];
  onChange?: (accountId: string) => void;
  locked?: boolean;
  disabled?: boolean;
}
export function FromPicker({
  address,
  accountId,
  mailboxes = [],
  onChange,
  locked = false,
  disabled = false,
}: FromPickerProps): React.ReactNode {
  const E = useEmailMessages();
  const L = useComposerMailboxMessages();
  const available = sendableComposerMailboxes(mailboxes);
  const canChoose =
    !locked && onChange !== undefined && available.some((mailbox) => mailbox.id !== accountId);
  return (
    <>
      <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">
        {E._extra.from}
      </span>
      {canChoose ? (
        <div className="min-w-0 flex-1">
          <Select
            value={accountId ?? ""}
            onChange={onChange}
            disabled={disabled}
            ariaLabel={L.chooseSender}
            triggerClassName="w-auto max-w-full border-transparent bg-transparent px-1.5 py-0.5 text-xs shadow-none hover:bg-accent"
            triggerContent={
              <bdi dir="ltr" className="truncate">
                {address}
              </bdi>
            }
            options={available.map((mailbox) => ({
              value: mailbox.id,
              label: `\u2068${mailbox.emailAddress}\u2069${mailbox.isDefault ? ` (${L.defaultSender})` : ""}`,
            }))}
          />
        </div>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
          <bdi dir="ltr" className="truncate">
            {address}
          </bdi>
          {locked && (
            <>
              <LockKeyhole aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
              <span className="sr-only">{L.replyLocked}</span>
            </>
          )}
        </span>
      )}
    </>
  );
}
