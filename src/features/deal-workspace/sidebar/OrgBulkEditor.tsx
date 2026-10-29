"use client";
import type React from "react";
import { useState } from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { InlineEditFooter } from "@/features/inline-edit/InlineEditFooter";
import { saveErrorMessage } from "@/features/inline-edit/saveError";
import { BulkEditRow } from "./BulkEditRow";

// The change shape OrgBlock.save accepts (kept in sync). All optional so the bulk save sends only
// the fields the user actually changed.
export interface OrgBulkChange {
  name?: string;
  domain?: string | null;
  linkedinUrl?: string | null;
  industry?: string | null;
  annualRevenue?: string | null;
  employeeCount?: number | null;
  address?: Record<string, unknown>;
}

interface OrgBulkEditorProps {
  org: {
    name: string;
    domain: string | null;
    linkedinUrl: string | null;
    industry: string | null;
    annualRevenue: string | null;
    employeeCount: number | null;
    address: Record<string, unknown> | null;
  };
  save: (change: OrgBulkChange) => Promise<{ ok: boolean; errorId?: string }>;
  onExit: () => void;
  // Built-in field keys hidden in Settings > Data fields; a hidden firmographic is not offered here.
  hidden?: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

const ADDRESS_PARTS = [
  { key: "street" },
  { key: "city" },
  { key: "region" },
  { key: "postal" },
  { key: "country" },
] as const;

const textOrNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());
const addrStr = (a: Record<string, unknown> | null, k: string): string =>
  typeof a?.[k] === "string" ? a[k] : "";

// Rebuild the address object from its edited parts, or undefined if nothing changed. Keeps only
// non-empty parts and preserves any lat/lng the geocoder set.
function addressChange(
  addr: Record<string, string>,
  original: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!ADDRESS_PARTS.some(({ key }) => addr[key] !== addrStr(original, key))) return undefined;
  const out: Record<string, unknown> = {};
  for (const { key } of ADDRESS_PARTS) {
    const v = (addr[key] ?? "").trim();
    if (v !== "") out[key] = v;
  }
  if (typeof original?.lat === "number") out.lat = original.lat;
  if (typeof original?.lng === "number") out.lng = original.lng;
  return out;
}

// Section bulk editor for the Organization block: every firmographic + the address parts open at
// once behind a single Save. Mounted only while the section is in bulk mode. Save sends one
// updateOrgAction with just the changed fields; the address is rebuilt from its parts (preserving
// lat/lng) only if any part changed.
export function OrgBulkEditor({
  org,
  save,
  onExit,
  hidden = NONE,
}: OrgBulkEditorProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const locale = useLocale();

  const [name, setName] = useState(org.name);
  const [domain, setDomain] = useState(org.domain ?? "");
  const [linkedin, setLinkedin] = useState(org.linkedinUrl ?? "");
  const [industry, setIndustry] = useState(org.industry ?? "");
  const [revenue, setRevenue] = useState(org.annualRevenue ?? "");
  const [employees, setEmployees] = useState(
    org.employeeCount === null ? "" : String(org.employeeCount),
  );
  const [addr, setAddr] = useState<Record<string, string>>(() => {
    const a: Record<string, string> = {};
    for (const { key } of ADDRESS_PARTS) a[key] = addrStr(org.address, key);
    return a;
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildChange(): OrgBulkChange {
    const change: OrgBulkChange = {};
    if (name.trim() !== org.name) change.name = name.trim();
    if (textOrNull(domain) !== org.domain) change.domain = textOrNull(domain);
    if (textOrNull(linkedin) !== org.linkedinUrl) change.linkedinUrl = textOrNull(linkedin);
    if (textOrNull(industry) !== org.industry) change.industry = textOrNull(industry);
    if (textOrNull(revenue) !== org.annualRevenue) change.annualRevenue = textOrNull(revenue);
    const emp = employees.trim() === "" ? null : Number(employees);
    if (emp !== org.employeeCount) change.employeeCount = emp;
    const nextAddress = addressChange(addr, org.address);
    if (nextAddress !== undefined) change.address = nextAddress;
    return change;
  }

  function onSave(): void {
    const change = buildChange();
    if (Object.keys(change).length === 0) {
      onExit();
      return;
    }
    setPending(true);
    setError(null);
    save(change)
      .then((r) => {
        setPending(false);
        if (r.ok) onExit();
        else setError(saveErrorMessage(r.errorId, locale));
      })
      .catch(() => {
        setPending(false);
        setError(saveErrorMessage(undefined, locale));
      });
  }

  return (
    <div className="flex flex-col gap-2">
      <BulkEditRow
        label={translateSales("name_dcd1d")}
        value={name}
        onChange={setName}
        disabled={pending}
      />
      {!hidden.has("domain") && (
        <BulkEditRow
          label={translateSales("website_b5a22")}
          value={domain}
          onChange={setDomain}
          disabled={pending}
        />
      )}
      {!hidden.has("linkedinUrl") && (
        <BulkEditRow
          label={translateSales("linkedin_dd844")}
          value={linkedin}
          onChange={setLinkedin}
          disabled={pending}
        />
      )}
      {!hidden.has("industry") && (
        <BulkEditRow
          label={translateSales("industry_b4448")}
          value={industry}
          onChange={setIndustry}
          disabled={pending}
        />
      )}
      {!hidden.has("annualRevenue") && (
        <BulkEditRow
          label={translateSales("annual_revenue_dcfdf")}
          value={revenue}
          onChange={setRevenue}
          disabled={pending}
        />
      )}
      {!hidden.has("employeeCount") && (
        <BulkEditRow
          label={translateSales("number_of_employees_abadd")}
          value={employees}
          onChange={setEmployees}
          disabled={pending}
        />
      )}
      {!hidden.has("address") &&
        ADDRESS_PARTS.map(({ key }) => (
          <BulkEditRow
            key={key}
            label={translateSales(key === "postal" ? "computed.postalCode" : `computed.${key}`)}
            value={addr[key] ?? ""}
            onChange={(v) => setAddr((prev) => ({ ...prev, [key]: v }))}
            disabled={pending}
          />
        ))}
      {error !== null ? (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      ) : null}
      <InlineEditFooter onCancel={onExit} onSave={onSave} saveDisabled={false} pending={pending} />
    </div>
  );
}
