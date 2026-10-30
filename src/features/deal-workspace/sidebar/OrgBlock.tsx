"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Organization } from "@/db/schema";
import { updateOrgAction } from "@/features/contacts/actions";
import { ContactCustomFieldRows } from "@/features/custom-fields/ContactCustomFieldRows";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { CustomFieldDef } from "@/types/customFields";
import { readCsrfToken } from "@/utils/csrfCookie";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { externalHref, LinkValue } from "./contactLinks";
import { LabelChips, type ResolvedLabelChip } from "./LabelChips";
import { OrgAddressField } from "./OrgAddressField";
import { OrgBulkEditor } from "./OrgBulkEditor";
import { SidebarFieldRow } from "./SidebarFieldRow";
import { refreshQuietly, textEditor } from "./sidebarEditors";

// Fields the Organization sidebar block can patch. All optional so each row only sends the
// one field it owns. Mirrors OrgFirmographicsPanel's field-to-column mapping.
type OrgFieldChange = Partial<{
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: string | null;
  linkedinUrl: string | null;
  address: Record<string, unknown>;
}>;

const ADDRESS_KEYS = ["street", "city", "region", "postal", "country"] as const;

const NONE: ReadonlySet<string> = new Set();

function formatAddress(address: Record<string, unknown> | null): string {
  if (address === null) return "-";
  const parts = ADDRESS_KEYS.map((key) => address[key]).filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return parts.length > 0 ? parts.join(", ") : "-";
}

// Editable firmographics for the deal-sidebar Organization section. Saves through
// updateOrgAction (org has no CAS precondition, last-write-wins) and refreshes the router
// afterward so the next render carries the server-true values.
export function OrgBlock({
  org,
  bulkEditing = false,
  onExitBulk,
  hidden = NONE,
  labels,
  customFieldDefs = [],
  currency = "USD",
}: {
  org: Organization;
  bulkEditing?: boolean;
  onExitBulk?: () => void;
  // Built-in field keys hidden in Settings > Data fields (see BUILTIN_FIELDS.organization). A hidden
  // firmographic row is neither shown nor offered in bulk edit, mirroring the org detail page.
  hidden?: ReadonlySet<string>;
  // Resolved label chips shown as a Labels row under Name. undefined on the deal sidebar; PD shows
  // per-organization labels on the lead drawer.
  labels?: ResolvedLabelChip[];
  customFieldDefs?: CustomFieldDef[];
  currency?: string;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const locale = useLocale();
  const format = useFormatters();
  const revenueText =
    org.annualRevenue === null
      ? ""
      : locale === "en"
        ? org.annualRevenue
        : format.number(org.annualRevenue, {
            useGrouping: false,
            minimumFractionDigits: org.annualRevenue.split(".")[1]?.length ?? 0,
            maximumFractionDigits: 20,
          });
  const employeesText =
    org.employeeCount === null ? "" : format.number(org.employeeCount, { useGrouping: false });

  const router = useRouter();
  const address = formatAddress(org.address);

  async function save(change: OrgFieldChange): Promise<{ ok: boolean; errorId?: string }> {
    const r = await updateOrgAction({ id: org.id, ...change }, readCsrfToken());
    if (!r.ok) return { ok: false, errorId: r.error.id };
    // Refresh only after a committed write, and never let a refresh failure mask that success.
    refreshQuietly(router);
    return { ok: true };
  }

  if (bulkEditing) {
    return (
      <OrgBulkEditor
        org={{
          name: org.name,
          domain: org.domain,
          linkedinUrl: org.linkedinUrl,
          industry: org.industry,
          annualRevenue: org.annualRevenue,
          employeeCount: org.employeeCount,
          address: org.address,
        }}
        save={save}
        onExit={onExitBulk ?? (() => {})}
        hidden={hidden}
      />
    );
  }

  return (
    <>
      <SidebarFieldRow
        label={translateSales("name_dcd1d")}
        value={
          <a href={`/contacts/orgs/${org.id}`} className="text-primary hover:underline">
            <bdi dir="auto">{org.name}</bdi>
          </a>
        }
        initialDraft={org.name}
        renderEditor={textEditor("editor-name")}
        onSave={(draft) => save({ name: draft.trim() })}
      />
      {labels !== undefined && (
        <SidebarFieldRow
          label={translateSales("labels_934b8")}
          value={<LabelChips labels={labels} />}
          readOnly
        />
      )}
      {!hidden.has("domain") && (
        <SidebarFieldRow
          label={translateSales("website_b5a22")}
          value={
            org.domain === null ? (
              "-"
            ) : (
              <LinkValue href={externalHref(org.domain)} external>
                {org.domain}
              </LinkValue>
            )
          }
          empty={org.domain === null}
          initialDraft={org.domain ?? ""}
          renderEditor={textEditor("editor-website")}
          onSave={(draft) => {
            const trimmed = draft.trim();
            return save({ domain: trimmed === "" ? null : trimmed });
          }}
        />
      )}
      {!hidden.has("linkedinUrl") && (
        <SidebarFieldRow
          label={translateSales("linkedin_dd844")}
          value={
            org.linkedinUrl === null ? (
              "-"
            ) : (
              <LinkValue href={externalHref(org.linkedinUrl)} external>
                {org.linkedinUrl}
              </LinkValue>
            )
          }
          empty={org.linkedinUrl === null}
          initialDraft={org.linkedinUrl ?? ""}
          renderEditor={textEditor("editor-linkedin")}
          onSave={(draft) => {
            const trimmed = draft.trim();
            return save({ linkedinUrl: trimmed === "" ? null : trimmed });
          }}
        />
      )}
      {!hidden.has("industry") && (
        <SidebarFieldRow
          label={translateSales("industry_b4448")}
          value={org.industry ?? "-"}
          empty={org.industry === null}
          initialDraft={org.industry ?? ""}
          renderEditor={textEditor("editor-industry")}
          onSave={(draft) => {
            const trimmed = draft.trim();
            return save({ industry: trimmed === "" ? null : trimmed });
          }}
        />
      )}
      {!hidden.has("annualRevenue") && (
        <SidebarFieldRow
          label={translateSales("annual_revenue_dcfdf")}
          value={revenueText === "" ? "-" : revenueText}
          empty={org.annualRevenue === null}
          initialDraft={revenueText}
          renderEditor={textEditor("editor-annual-revenue")}
          onSave={(draft, draftLocale) => {
            const trimmed = draft.trim();
            if (trimmed === "") return save({ annualRevenue: null });
            const normalized = normalizeNumberInput(trimmed, draftLocale);
            if (normalized === null || !/^\d+(?:\.\d{1,2})?$/.test(normalized))
              return Promise.resolve({
                ok: false,
                errorId: ERROR_IDS.CONTACT_UPDATE_INPUT_INVALID,
              });
            return save({ annualRevenue: normalized });
          }}
        />
      )}
      {!hidden.has("employeeCount") && (
        <SidebarFieldRow
          label={translateSales("number_of_employees_abadd")}
          value={employeesText === "" ? "-" : employeesText}
          empty={org.employeeCount === null}
          initialDraft={employeesText}
          renderEditor={textEditor("editor-employees")}
          onSave={(draft, draftLocale) => {
            const trimmed = draft.trim();
            if (trimmed === "") return save({ employeeCount: null });
            const normalized = normalizeNumberInput(trimmed, draftLocale);
            const count = normalized === null ? NaN : Number(normalized);
            if (!Number.isSafeInteger(count) || count < 0)
              return Promise.resolve({
                ok: false,
                errorId: ERROR_IDS.CONTACT_UPDATE_INPUT_INVALID,
              });
            return save({ employeeCount: count });
          }}
        />
      )}
      {!hidden.has("address") && (
        <OrgAddressField orgId={org.id} address={org.address} formatted={address} />
      )}
      <ContactCustomFieldRows
        contact={{
          kind: "organization",
          id: org.id,
          customFields: org.customFields as Record<string, unknown>,
        }}
        defs={customFieldDefs}
        currency={currency}
      />
    </>
  );
}
