"use client";
import { Building2, Flag, Tag, User, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
import { CurrencySelect } from "@/features/currencies/CurrencySelect";
import { updateDealAction } from "@/features/deals/updateAction";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { InlineEditFooter } from "@/features/inline-edit/InlineEditFooter";
import { InlineFieldShell } from "@/features/inline-edit/InlineFieldShell";
import { saveErrorMessage } from "@/features/inline-edit/saveError";
import { canonicalMoney } from "@/lib/canonicalMoney";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { parseMoneyValue } from "@/utils/entityFormFields";
import { LabelRow } from "./LabelRow";
import { ParticipantsControl } from "./ParticipantsControl";
import { InlineOrgField } from "./sidebar/InlineOrgField";

interface SummaryDeal {
  id: string;
  updatedAt: string | Date;
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
  const expectedUpdatedAt = new Date(deal.updatedAt).toISOString();
  const [editingValue, setEditingValue] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftLocale, setDraftLocale] = useState(locale);
  const [currency, setCurrency] = useState(deal.currency ?? baseCurrency);
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState<string | null>(deal.expectedCloseDate);
  const [errorId, setErrorId] = useState<string | null>(null);

  async function save(change: {
    value?: number | string | null;
    currency?: string;
    expectedCloseDate?: string | null;
  }): Promise<void> {
    const r = await updateDealAction(
      { dealId: deal.id, expectedUpdatedAt, ...change },
      readCsrfToken(),
    );
    setErrorId(r.ok ? null : r.error.id);
    router.refresh();
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
    setEditingValue(false);
    void save({ value: parsedValue, currency });
  }

  return (
    <div className="text-sm">
      <ActionRow icon={<Wallet aria-hidden="true" className={ICON} />}>
        <InlineFieldShell
          label={translateSales("value_8e379")}
          editing={editingValue}
          onStartEdit={() => {
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
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitValue();
              }}
              className="h-8 w-full rounded border border-field-border bg-card px-2 text-start text-sm"
            />
            <CurrencySelect value={currency} onChange={setCurrency} />
            <InlineEditFooter
              onCancel={() => setEditingValue(false)}
              onSave={commitValue}
              saveDisabled={!valueDirty}
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
          expectedUpdatedAt={expectedUpdatedAt}
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
        <LabelRow dealId={deal.id} expectedUpdatedAt={expectedUpdatedAt} labels={deal.labels} />
      </ActionRow>

      <ActionRow icon={<Flag aria-hidden="true" className={ICON} />}>
        <InlineFieldShell
          label={translateSales("expected_close_date_af65c")}
          editing={editingDate}
          onStartEdit={() => {
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
              onChange={setDateDraft}
            />
            <InlineEditFooter
              onCancel={() => setEditingDate(false)}
              onSave={() => {
                if (dateDraft === deal.expectedCloseDate) return;
                setEditingDate(false);
                void save({ expectedCloseDate: dateDraft });
              }}
              saveDisabled={dateDraft === deal.expectedCloseDate}
            />
          </div>
        </InlineFieldShell>
      </ActionRow>
    </div>
  );
}
