"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { profileRequest } from "@/features/company-profile/ui/api";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { type CompanyBillingPrefill, companyBillingPrefillSchema } from "./companyPrefill";
import type { BillingDraft } from "./types";

const copy = {
  en: {
    load: "Use company details",
    hint: "Review the selected legal entity before copying it into this checkout form. This does not update Stripe or change past invoices.",
    entity: "Legal entity",
    confirm: "Copy into billing form",
    empty: "Add a legal entity in Company settings first.",
    settings: "Company legal settings",
    error: "Could not load company details. You can enter billing details manually.",
  },
  de: {
    load: "Unternehmensdaten verwenden",
    hint: "Rechtseinheit prüfen und in dieses Zahlungsformular kopieren. Dadurch werden weder Stripe noch frühere Rechnungen geändert.",
    entity: "Rechtseinheit",
    confirm: "In Zahlungsformular kopieren",
    empty: "Zuerst eine Rechtseinheit in den Unternehmenseinstellungen anlegen.",
    settings: "Rechtliche Firmendaten",
    error:
      "Unternehmensdaten konnten nicht geladen werden. Zahlungsdaten können manuell eingegeben werden.",
  },
  fa: {
    load: "استفاده از اطلاعات شرکت",
    hint: "پیش از کپی در فرم پرداخت، شخص حقوقی را بررسی کنید. این کار اطلاعات Stripe یا صورتحساب‌های قبلی را تغییر نمی‌دهد.",
    entity: "شخص حقوقی",
    confirm: "کپی در فرم پرداخت",
    empty: "ابتدا شخص حقوقی را در تنظیمات شرکت اضافه کنید.",
    settings: "تنظیمات حقوقی شرکت",
    error: "اطلاعات شرکت دریافت نشد. می‌توانید اطلاعات پرداخت را دستی وارد کنید.",
  },
};
export function CompanyBillingCopy({
  onCopy,
  disabled,
}: {
  onCopy: (draft: BillingDraft) => void;
  disabled: boolean;
}) {
  const L = copy[useLocale()];
  const [data, setData] = useState<CompanyBillingPrefill | null>(null);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function load() {
    setPending(true);
    setFailed(false);
    try {
      const next = await profileRequest(
        "/api/company-billing-copy",
        companyBillingPrefillSchema,
        AbortSignal.timeout(15000),
      );
      setData(next);
      setSelected(next.preferredId ?? next.entries[0]?.id ?? "");
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  const draft = data?.entries.find((v) => v.id === selected)?.draft;
  return (
    <div className="ph-no-capture ph-block-email mb-5 space-y-3 rounded-md border p-4">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || pending}
        onClick={() => void load()}
      >
        {L.load}
      </Button>
      {failed && <p role="alert">{L.error}</p>}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">{L.hint}</p>
          {data.entries.length > 0 ? (
            <Select
              ariaLabel={L.entity}
              value={selected}
              onChange={setSelected}
              options={data.entries.map((v) => ({ value: v.id, label: v.draft.name }))}
              contentClassName="ph-no-capture ph-block-email"
              disabled={disabled}
            />
          ) : (
            <p>
              {L.empty}{" "}
              <Link className="underline" href="/settings/company/legal">
                {L.settings}
              </Link>
            </p>
          )}
          {draft && (
            <>
              <div className="break-words text-sm">
                <p>
                  <bdi>{draft.name}</bdi>
                </p>
                <p>
                  <bdi>
                    {[draft.line1, draft.line2, draft.city, draft.postalCode, draft.country]
                      .filter(Boolean)
                      .join(", ")}
                  </bdi>
                </p>
                <p>
                  <bdi>
                    {draft.email} {draft.taxId}
                  </bdi>
                </p>
              </div>
              <Button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onCopy(draft);
                  setData(null);
                }}
              >
                {L.confirm}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
