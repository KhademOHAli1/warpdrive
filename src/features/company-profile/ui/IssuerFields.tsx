"use client";
import type { LegalEntityData } from "../contracts";
import { useCompanyMessages } from "../messages";
import { ChoiceField, TextField } from "./Fields";

type Issuer = LegalEntityData["issuerDefaults"];
export function IssuerFields({
  value: v,
  onChange,
  disabled,
}: {
  value: Issuer;
  onChange: (value: Issuer) => void;
  disabled: boolean;
}) {
  const m = useCompanyMessages();
  const patch = (next: Partial<Issuer>) => onChange({ ...v, ...next });
  const textKeys = [
    "currency",
    "numberingSeries",
    "exemptionReason",
    "legalFooter",
    "paymentInstructions",
    "payeeName",
    "iban",
    "bic",
    "invoiceEmail",
    "electronicAddress",
    "electronicAddressScheme",
  ] as const;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <p className="col-span-full text-sm text-muted-foreground">{m.identityOnly}</p>
      {textKeys.map((key) => (
        <TextField
          key={key}
          label={m[key]}
          value={v[key]}
          maxLength={
            key === "legalFooter"
              ? 4000
              : key === "paymentInstructions"
                ? 2000
                : key === "exemptionReason"
                  ? 1000
                  : 300
          }
          multiline={key === "legalFooter" || key === "paymentInstructions"}
          onChange={(value) =>
            patch({
              [key]: ["currency", "iban", "bic"].includes(key) ? value.toUpperCase() : value,
            })
          }
          disabled={disabled}
        />
      ))}
      <ChoiceField
        label={m.language}
        value={v.language}
        options={[
          { value: "", label: m.unspecified },
          { value: "en", label: "English" },
          { value: "de", label: "Deutsch" },
          { value: "fa", label: "فارسی" },
        ]}
        onChange={(language) => {
          if (language === "" || language === "en" || language === "de" || language === "fa")
            patch({ language });
        }}
        disabled={disabled}
      />
      <TextField
        label={m.paymentTermsDays}
        type="number"
        value={v.paymentTermsDays === null ? "" : String(v.paymentTermsDays)}
        onChange={(value) => patch({ paymentTermsDays: value === "" ? null : Number(value) })}
        disabled={disabled}
      />
      <ChoiceField
        label={m.taxRegime}
        value={v.taxRegime}
        options={["unknown", "standard", "small_business", "exempt"].map((value) => ({
          value,
          label:
            value === "unknown"
              ? m.unknown
              : value === "standard"
                ? m.standard
                : value === "small_business"
                  ? m.small_business
                  : m.exempt,
        }))}
        onChange={(taxRegime) => {
          if (
            taxRegime === "unknown" ||
            taxRegime === "standard" ||
            taxRegime === "small_business" ||
            taxRegime === "exempt"
          )
            patch({ taxRegime });
        }}
        disabled={disabled}
      />
      <ChoiceField
        label={m.structuredProfile}
        value={v.structuredProfile}
        options={[
          { value: "none", label: m.none },
          { value: "xrechnung", label: "XRechnung" },
          { value: "zugferd", label: "ZUGFeRD" },
          { value: "other", label: m.other },
        ]}
        onChange={(structuredProfile) => {
          if (
            structuredProfile === "none" ||
            structuredProfile === "xrechnung" ||
            structuredProfile === "zugferd" ||
            structuredProfile === "other"
          )
            patch({ structuredProfile });
        }}
        disabled={disabled}
      />
    </div>
  );
}
