"use client";
import type { CompanyDetails } from "../contracts";
import { useCompanyMessages } from "../messages";
import { BusinessHours } from "./BusinessHours";
import { ContactRows } from "./ContactRows";
import { ChoiceField, Section, TextField } from "./Fields";
import { ListField } from "./ListField";
export function DetailsFields({
  value: v,
  onChange,
  disabled,
}: {
  value: CompanyDetails;
  onChange: (value: CompanyDetails) => void;
  disabled: boolean;
}) {
  const m = useCompanyMessages();
  const patch = (next: Partial<CompanyDetails>) => onChange({ ...v, ...next });
  const text = (
    key:
      | "companyName"
      | "website"
      | "industry"
      | "servicesDescription"
      | "publicEmail"
      | "publicPhone"
      | "timeZone"
      | "dateFormat"
      | "numberFormat",
  ) => (
    <TextField
      key={key}
      label={m[key]}
      value={v[key]}
      onChange={(value) => patch({ [key]: value })}
      disabled={disabled}
      multiline={key === "servicesDescription"}
      maxLength={key === "servicesDescription" ? 4000 : key === "website" ? 2048 : 200}
    />
  );
  return (
    <div className="space-y-5">
      <Section title={m.identity} description={m.optional}>
        {text("companyName")}
        {text("website")}
        {text("industry")}
        {text("servicesDescription")}
        <ListField
          label={m.industryTags}
          value={v.industryTags}
          onChange={(industryTags) => patch({ industryTags })}
          disabled={disabled}
        />
      </Section>
      <details className="rounded-lg border p-5">
        <summary className="cursor-pointer text-sm font-semibold">{m.classification}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(["scheme", "version", "code"] as const).map((key) => (
            <TextField
              key={key}
              label={m[key]}
              value={v.industryCode?.[key] ?? ""}
              onChange={(value) => {
                const code = { scheme: "", version: "", code: "", ...v.industryCode, [key]: value };
                patch({
                  industryCode: Object.values(code).every((entry) => entry === "") ? null : code,
                });
              }}
              disabled={disabled}
              maxLength={40}
            />
          ))}
        </div>
      </details>
      <Section title={m.team} description={m.seatsHint}>
        <ChoiceField
          label={m.employeeBand}
          value={v.employeeBand}
          options={[
            { value: "", label: m.unspecified },
            { value: "solo", label: m.solo },
            ...["2_9", "10_49", "50_249", "250_999", "1000_plus"].map((value) => ({
              value,
              label: value.replace("_plus", "+").replace("_", "–"),
            })),
          ]}
          onChange={(value) => {
            const options = ["", "solo", "2_9", "10_49", "50_249", "250_999", "1000_plus"] as const;
            const employeeBand = options.find((entry) => entry === value);
            if (employeeBand !== undefined) patch({ employeeBand });
          }}
          disabled={disabled}
        />
        <ChoiceField
          label={m.employeeScope}
          value={v.employeeScope}
          options={[
            { value: "", label: m.unspecified },
            { value: "entity", label: m.entity },
            { value: "group", label: m.group },
          ]}
          onChange={(employeeScope) => {
            if (employeeScope === "" || employeeScope === "entity" || employeeScope === "group")
              patch({ employeeScope });
          }}
          disabled={disabled}
        />
        <TextField
          label={m.employeeAsOf}
          type="date"
          value={v.employeeAsOf}
          onChange={(employeeAsOf) => patch({ employeeAsOf })}
          disabled={disabled}
        />
        <TextField
          label={m.intendedTeamSize}
          type="number"
          value={v.intendedTeamSize === null ? "" : String(v.intendedTeamSize)}
          onChange={(value) => patch({ intendedTeamSize: value === "" ? null : Number(value) })}
          disabled={disabled}
        />
        <ListField
          label={m.operatingCountries}
          value={v.operatingCountries}
          onChange={(operatingCountries) =>
            patch({
              operatingCountries: operatingCountries.map((country) => country.toUpperCase()),
            })
          }
          disabled={disabled}
          max={100}
        />
      </Section>
      <Section title={m.contact}>
        {text("publicEmail")}
        {text("publicPhone")}
        <ListField
          label={m.socialLinks}
          value={v.socialLinks}
          onChange={(socialLinks) => patch({ socialLinks })}
          disabled={disabled}
        />
      </Section>
      <details className="rounded-lg border p-5">
        <summary className="cursor-pointer text-sm font-semibold">{m.roleContacts}</summary>
        <div className="mt-4">
          <ContactRows
            value={v.roleContacts}
            onChange={(roleContacts) => patch({ roleContacts })}
            disabled={disabled}
          />
        </div>
      </details>
      <Section title={m.regional}>
        <ChoiceField
          label={m.locale}
          value={v.locale}
          options={[
            { value: "", label: m.unspecified },
            { value: "en", label: "English" },
            { value: "de", label: "Deutsch" },
            { value: "fa", label: "فارسی" },
          ]}
          onChange={(locale) => {
            if (locale === "" || locale === "en" || locale === "de" || locale === "fa")
              patch({ locale });
          }}
          disabled={disabled}
        />
        {text("timeZone")}
        {text("dateFormat")}
        {text("numberFormat")}
      </Section>
      <details className="rounded-lg border p-5">
        <summary className="cursor-pointer text-sm font-semibold">{m.businessHours}</summary>
        <div className="mt-4">
          <BusinessHours
            value={v.businessHours}
            onChange={(businessHours) => patch({ businessHours })}
            disabled={disabled}
          />
        </div>
      </details>
    </div>
  );
}
