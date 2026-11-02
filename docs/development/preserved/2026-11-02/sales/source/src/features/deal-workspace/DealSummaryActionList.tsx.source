"use client";

import { Building2, Flag, Tag, User, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useRef, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { ERROR_IDS } from "@/constants/errorIds";
import { CurrencySelect } from "@/features/currencies/CurrencySelect";
import { dealClientResult } from "@/features/deals/dealClientResult";
import { updateDealAction } from "@/features/deals/updateAction";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { InlineEditFooter } from "@/features/inline-edit/InlineEditFooter";
import { InlineFieldShell } from "@/features/inline-edit/InlineFieldShell";
import { canonicalMoney } from "@/lib/canonicalMoney";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { parseMoneyValue } from "@/utils/entityFormFields";
import { dealEditErrorMessage as saveErrorMessage } from "./dealEditErrorMessage";
import { LabelRow } from "./LabelRow";
import { ParticipantsControl } from "./ParticipantsControl";
import { InlineOrgField } from "./sidebar/InlineOrgField";

interface SummaryDeal {
  id: string;
  updatedAt: string | Date;
  writeVersion: string;
  value: number | string | null;
  currency?: string;
  expectedCloseDate: string | null;
  labels: string[];
}

const ICON = "h-4 w-4";

// One Summary row: PD's icon-gutter + content layout (no field labels). `right` carries the
// row's end-aligned shortcut (+ Participants on the person row).
function ActionRow({
  icon,
  children,
  right,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="flex w-4 shrink-0 justify-center text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {right !== undefined && <div className="shrink-0">{right}</div>}
    </div>
  );
}

// Pipedrive-exact deal Summary (minus out-of-scope Scores/Products/sequence/Project): an action
// list, not a label/value table. Values render as text or entity links; empty fields are blue
// CTAs ("Add labels", "Set expected close date"); "+ Participants" hangs on the person row.
// Owner lives in the page header, matching PD.
export function DealSummaryActionList({
  deal,
  person,
  org,
  orgOptions = [],
  baseCurrency,
}: {
  deal: SummaryDeal;
  person: { id: string; name: string } | null;
  org: { id: string; name: string } | null;
  orgOptions?: Array<{ id: string; name: string }>;
  baseCurrency: string;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const router = useRouter();
  const locale = useLocale();
  const format = useFormatters();
  const expectedWriteVersion = deal.writeVersion;
  const [editingValue, setEditingValue] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftLocale, setDraftLocale] = useState(locale);
  const [currency, setCurrency] = useState(deal.currency ?? baseCurrency);
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState<string | null>(deal.expectedCloseDate);
  const [errorId, setErrorId] = useState<string | null>(null);
  const valueVersion = useRef<string | null>(null);
  const dateVersion = useRef<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(
    change: {
      value?: number | string | null;
      currency?: string;
      expectedCloseDate?: string | null;
    },
    version: string | null,
  ): Promise<boolean> {
    if (pending) return false;
    if (version === null) {
      setErrorId(ERROR_IDS.DEAL_PRECONDITION);
      return false;
    }
    setPending(true);
    try {
      const r = await dealClientResult(() =>
        updateDealAction(
          { dealId: deal.id, expectedWriteVersion: version, ...change },
          readCsrfToken(),
        ),
      );
      setErrorId(r.ok ? null : r.error.id);
      if (r.ok || r.error.id === ERROR_IDS.DEAL_PRECONDITION) router.refresh();
      return r.ok;
    } catch {
      setErrorId("");
      return false;
    } finally {
      setPending(false);
    }
  }

  // Dirty + parseable gating for the value editor's Save (PD disables Save until the
  // draft differs; an unparseable draft must never commit).
  const parsedMoney = parseMoneyValue(draft, draftLocale);
  const parsedValue = parsedMoney.ok ? parsedMoney.value : null;
  const valueValid = parsedMoney.ok;
  const valueDirty =
    valueValid &&
    ((parsedValue === null ? null : canonicalMoney(String(parsedValue))) !==
      (deal.value === null ? null : canonicalMoney(String(deal.value))) ||
      currency !== (deal.currency ?? baseCurrency));

  function commitValue(): void {
    if (!valueDirty) return;
    void save({ value: parsedValue, currency }, valueVersion.current).then((saved) => {
      if (saved) setEditingValue(false);
    });
  }

  return (
    <div className="text-sm">
      <ActionRow icon={<Wallet aria-hidden="true" className={ICON} />}>
        <InlineFieldShell
          label={translateSales("value_8e379")}
          editing={editingValue}
          onStartEdit={() => {
            valueVersion.current = expectedWriteVersion;
            setDraft(
              deal.value !== null
                ? format.number(deal.value, { useGrouping: false, maximumFractionDigits: 20 })
                : "",
            );
            setDraftLocale(locale);
            setCurrency(deal.currency ?? baseCurrency);
            setEditingValue(true);
          }}
          value={`${format.currency(deal.value ?? 0, deal.currency ?? baseCurrency)} ${deal.currency ?? baseCurrency}`}
        >
          <div>
            <input
              aria-label={translateSales("value_8e379")}
              // biome-ignore lint/a11y/noAutofocus: inline edit focuses immediately on activation
              autoFocus
              inputMode="decimal"
              value={draft}
              disabled={pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitValue();
              }}
              className="h-8 w-full rounded border border-field-border bg-card px-2 text-start text-sm"
            />
            <CurrencySelect
              value={currency}
              onChange={(next) => {
                if (!pending) setCurrency(next);
              }}
            />
            <InlineEditFooter
              onCancel={() => setEditingValue(false)}
              onSave={commitValue}
              saveDisabled={!valueDirty}
              pending={pending}
            />
          </div>
        </InlineFieldShell>
        {errorId !== null && (
          <span className="ms-2 text-xs text-destructive">{saveErrorMessage(errorId, locale)}</span>
        )}
      </ActionRow>

      <ActionRow icon={<Building2 aria-hidden="true" className={ICON} />}>
        <InlineOrgField
          dealId={deal.id}
          expectedWriteVersion={expectedWriteVersion}
          org={org}
          orgOptions={orgOptions}
          onSaved={() => router.refresh()}
        />
      </ActionRow>

      {person !== null && (
        <ActionRow
          icon={<User aria-hidden="true" className={ICON} />}
          right={
            <ParticipantsControl
              dealId={deal.id}
              orgId={org?.id ?? null}
              orgName={org?.name ?? null}
            />
          }
        >
          <Link
            href={`/contacts/people/${person.id}`}
            className="font-semibold text-primary hover:underline"
          >
            <bdi dir="auto">{person.name}</bdi>
          </Link>
        </ActionRow>
      )}

      <ActionRow icon={<Tag aria-hidden="true" className={ICON} />}>
        <LabelRow
          dealId={deal.id}
          expectedWriteVersion={expectedWriteVersion}
          labels={deal.labels}
        />
      </ActionRow>

      <ActionRow icon={<Flag aria-hidden="true" className={ICON} />}>
        <InlineFieldShell
          label={translateSales("expected_close_date_af65c")}
          editing={editingDate}
          onStartEdit={() => {
            dateVersion.current = expectedWriteVersion;
            setDateDraft(deal.expectedCloseDate);
            setEditingDate(true);
          }}
          value={deal.expectedCloseDate !== null ? format.dateOnly(deal.expectedCloseDate) : null}
          emptyPrompt={translateSales("set_expected_close_date_c5fe2")}
        >
          <div>
            <DatePicker
              ariaLabel={translateSales("expected_close_date_af65c")}
              value={dateDraft}
              placeholder={translateSales("set_date_08c6c")}
              defaultOpen
              triggerClassName="flex h-8 w-full items-center rounded border border-field-border bg-card px-2 text-start text-sm"
              formatLabel={format.dateOnly}
              onChange={(next) => {
                if (!pending) setDateDraft(next);
              }}
            />
            <InlineEditFooter
              onCancel={() => setEditingDate(false)}
              onSave={() => {
                if (dateDraft === deal.expectedCloseDate) return;
                void save({ expectedCloseDate: dateDraft }, dateVersion.current).then((saved) => {
                  if (saved) setEditingDate(false);
                });
              }}
              saveDisabled={dateDraft === deal.expectedCloseDate}
              pending={pending}
            />
          </div>
        </InlineFieldShell>
      </ActionRow>
    </div>
  );
}
