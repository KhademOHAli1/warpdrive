"use client";

import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { ReplyMailbox } from "./contracts";

const messages = {
  en: {
    label: "Reply-To",
    manual: "Manual headers",
    help: "Replies arrive through the selected CRM inbox connection.",
    loading: "Loading connected inboxes…",
    noMailboxes: "You have no connected CRM inboxes that receive mail.",
    unavailable: "Selected inbox unavailable",
    loadError: "Connected inboxes could not be loaded.",
    saveError: "Choose an available CRM inbox or use manual headers.",
  },
  de: {
    label: "Antwortadresse",
    manual: "Manuelle E-Mail-Header",
    help: "Antworten kommen über die ausgewählte CRM-Postfachverbindung an.",
    loading: "Verbundene Postfächer werden geladen…",
    noMailboxes: "Du hast keine verbundenen CRM-Postfächer, die E-Mails empfangen.",
    unavailable: "Ausgewähltes Postfach nicht verfügbar",
    loadError: "Verbundene Postfächer konnten nicht geladen werden.",
    saveError: "Wähle ein verfügbares CRM-Postfach oder nutze manuelle E-Mail-Header.",
  },
  fa: {
    label: "نشانی پاسخ",
    manual: "سرآیندهای دستی",
    help: "پاسخ‌ها از طریق اتصال صندوق ورودی انتخاب‌شده به CRM می‌رسند.",
    loading: "در حال بارگیری صندوق‌های ورودی متصل…",
    noMailboxes: "هیچ صندوق ورودی متصل به CRM برای دریافت ایمیل ندارید.",
    unavailable: "صندوق ورودی انتخاب‌شده در دسترس نیست",
    loadError: "صندوق‌های ورودی متصل بارگیری نشدند.",
    saveError: "یک صندوق ورودی در دسترس انتخاب کنید یا از سرآیندهای دستی استفاده کنید.",
  },
};

export function useReplyRoutingMessages() {
  return messages[useLocale()];
}

function mailboxOptions(
  mailboxId: string | null,
  mailboxes: ReplyMailbox[],
  loading: boolean,
  m: ReturnType<typeof useReplyRoutingMessages>,
) {
  const options = [{ value: "", label: m.manual }];
  if (mailboxId !== null && !mailboxes.some(({ id }) => id === mailboxId)) {
    options.push({ value: mailboxId, label: loading ? m.loading : m.unavailable });
  }
  for (const { id, address, displayName } of mailboxes) {
    const label =
      displayName === undefined || displayName === "" ? address : `${displayName} · ${address}`;
    options.push({ value: id, label });
  }
  return options;
}

export function ReplyRoutingField({
  mailboxId,
  mailboxes,
  loading,
  failed,
  readOnly,
  disabled,
  savedAddress,
  onChange,
}: {
  mailboxId: string | null;
  mailboxes: ReplyMailbox[];
  loading: boolean;
  failed: boolean;
  readOnly: boolean;
  disabled: boolean;
  savedAddress: string | undefined;
  onChange: (id: string | null) => void;
}) {
  const m = useReplyRoutingMessages();
  if (readOnly) {
    if (mailboxId === null) return null;
    return (
      <div className="grid gap-1.5 text-sm">
        <p className="font-medium">{m.label}</p>
        <p className="text-muted-foreground">
          <bdi>{savedAddress ?? m.unavailable}</bdi>
        </p>
      </div>
    );
  }
  const hint = loading
    ? m.loading
    : failed
      ? m.loadError
      : mailboxes.length > 0
        ? m.help
        : m.noMailboxes;
  return (
    <div className="grid gap-1.5 text-sm">
      <p className="font-medium">{m.label}</p>
      <Select
        ariaLabel={m.label}
        value={mailboxId ?? ""}
        options={mailboxOptions(mailboxId, mailboxes, loading, m)}
        onChange={(id) => onChange(id === "" ? null : id)}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}
