"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LegalEntity, LegalEntityData } from "../contracts";
import { useCompanyMessages } from "../messages";
import { ContactRows } from "./ContactRows";
import { ChoiceField, Section, TextField } from "./Fields";
import { IssuerFields } from "./IssuerFields";
export function LegalFields({
  value: v,
  entities,
  onChange,
  disabled,
}: {
  value: LegalEntityData;
  entities: LegalEntity[];
  onChange: (value: LegalEntityData) => void;
  disabled: boolean;
}) {
  const m = useCompanyMessages();
  const [taxKeys, setTaxKeys] = useState(() => v.taxIds.map(() => crypto.randomUUID()));
  const patch = (next: Partial<LegalEntityData>) => onChange({ ...v, ...next });
  const text = (
    key:
      | "legalName"
      | "tradingName"
      | "country"
      | "legalForm"
      | "registeredSeat"
      | "registrationNumber"
      | "registerAuthority",
  ) => (
    <TextField
      key={key}
      label={
        v.country === "DE" && key === "registrationNumber"
          ? m.germanRegistrationNumber
          : v.country === "DE" && key === "registerAuthority"
            ? m.germanRegisterAuthority
            : m[key]
      }
      value={v[key]}
      disabled={disabled}
      onChange={(value) => patch({ [key]: key === "country" ? value.toUpperCase() : value })}
    />
  );
  return (
    <div className="space-y-5">
      <Section title={m.identity}>
        {text("legalName")}
        {text("tradingName")}
        {text("country")}
        {text("legalForm")}
        {text("registeredSeat")}
        {text("registrationNumber")}
        {text("registerAuthority")}
        <ChoiceField
          label={m.parentEntity}
          value={v.parentEntityId ?? ""}
          options={[
            { value: "", label: m.none },
            ...entities
              .filter((entity) => !entity.archived)
              .map((entity) => ({ value: entity.id, label: entity.data.legalName })),
          ]}
          onChange={(value) => patch({ parentEntityId: value || null })}
          disabled={disabled}
        />
      </Section>
      <Section title={m.address}>
        {(["line1", "line2", "city", "state", "postalCode", "country"] as const).map((key) => (
          <TextField
            key={key}
            label={m[key]}
            value={v.registeredAddress[key]}
            disabled={disabled}
            onChange={(value) =>
              patch({
                registeredAddress: {
                  ...v.registeredAddress,
                  [key]: key === "country" ? value.toUpperCase() : value,
                },
              })
            }
          />
        ))}
      </Section>
      <Section title={m.taxIds}>
        <div className="col-span-full space-y-3">
          {v.taxIds.map((tax, index) => (
            <div key={taxKeys[index]} className="grid gap-3 rounded-md border p-3 sm:grid-cols-4">
              <ChoiceField
                label={`${m.taxIds} ${index + 1}`}
                value={tax.type}
                options={["vat", "tax_number", "other"].map((type) => ({
                  value: type,
                  label:
                    type === "vat"
                      ? tax.country === "DE"
                        ? m.germanVat
                        : m.vat
                      : type === "tax_number"
                        ? m.tax_number
                        : m.other,
                }))}
                onChange={(type) => {
                  if (type === "vat" || type === "tax_number" || type === "other")
                    patch({
                      taxIds: v.taxIds.map((entry, i) =>
                        i === index ? { ...entry, type } : entry,
                      ),
                    });
                }}
                disabled={disabled}
              />
              <TextField
                label={`${m.country} ${index + 1}`}
                value={tax.country}
                onChange={(country) =>
                  patch({
                    taxIds: v.taxIds.map((entry, i) =>
                      i === index ? { ...entry, country: country.toUpperCase() } : entry,
                    ),
                  })
                }
                disabled={disabled}
              />
              <TextField
                label={`${m.value} ${index + 1}`}
                value={tax.value}
                onChange={(value) =>
                  patch({
                    taxIds: v.taxIds.map((entry, i) => (i === index ? { ...entry, value } : entry)),
                  })
                }
                disabled={disabled}
              />
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  setTaxKeys(taxKeys.filter((_, i) => index !== i));
                  patch({ taxIds: v.taxIds.filter((_, i) => index !== i) });
                }}
              >
                {m.remove}
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            disabled={disabled || v.taxIds.length >= 20}
            onClick={() => {
              setTaxKeys([...taxKeys, crypto.randomUUID()]);
              patch({ taxIds: [...v.taxIds, { type: "vat", country: v.country, value: "" }] });
            }}
          >
            {m.add}
          </Button>
        </div>
      </Section>
      <details className="rounded-lg border p-5">
        <summary className="cursor-pointer text-sm font-semibold">{m.representatives}</summary>
        <div className="mt-4">
          <ContactRows
            value={v.representatives}
            onChange={(representatives) => patch({ representatives })}
            disabled={disabled}
          />
        </div>
      </details>
      <details className="rounded-lg border p-5">
        <summary className="cursor-pointer text-sm font-semibold">{m.contacts}</summary>
        <div className="mt-4">
          <ContactRows
            value={v.contacts}
            onChange={(contacts) => patch({ contacts })}
            disabled={disabled}
          />
        </div>
      </details>
      <details className="rounded-lg border p-5">
        <summary className="cursor-pointer text-sm font-semibold">{m.issuer}</summary>
        <div className="mt-4">
          <IssuerFields
            value={v.issuerDefaults}
            onChange={(issuerDefaults) => patch({ issuerDefaults })}
            disabled={disabled}
          />
        </div>
      </details>
      <Section title={m.source}>
        <ChoiceField
          label={m.source}
          value={v.source.kind}
          options={["manual", "registry", "website", "import"].map((kind) => ({
            value: kind,
            label:
              kind === "manual"
                ? m.manual
                : kind === "registry"
                  ? m.registry
                  : kind === "website"
                    ? m.website
                    : m.import,
          }))}
          onChange={(kind) => {
            if (kind === "manual" || kind === "registry" || kind === "website" || kind === "import")
              patch({ source: { ...v.source, kind } });
          }}
          disabled={disabled}
        />
        <TextField
          label={m.sourceUrl}
          value={v.source.url}
          maxLength={2048}
          onChange={(url) => patch({ source: { ...v.source, url } })}
          disabled={disabled}
        />
        <TextField
          label={m.recordId}
          value={v.source.recordId}
          onChange={(recordId) => patch({ source: { ...v.source, recordId } })}
          disabled={disabled}
        />
      </Section>
    </div>
  );
}
