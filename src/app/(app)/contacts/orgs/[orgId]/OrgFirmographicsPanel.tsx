"use client";
import type React from "react";
import { updateOrgAction } from "@/features/contacts/actions";
import { FieldRow } from "@/features/deal-workspace/sidebar/FieldRow";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { InlineTextField } from "@/features/inline-edit/InlineTextField";
import { useFormatters } from "@/lib/useFormatters";
import { err, ok, type Result } from "@/types/result";
import { readCsrfToken } from "@/utils/csrfCookie";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";

interface PanelOrg {
  id: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: string | null;
  linkedinUrl: string | null;
}

interface OrgFirmographicsPanelProps {
  org: PanelOrg;
  onSaved: () => void;
  // Hidden built-in field keys (settings > Data fields). A hidden firmographic row is not rendered.
  hidden?: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

type FirmographicPatch = Partial<{
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: string | null;
  linkedinUrl: string | null;
}>;

// Click-to-edit-in-place Details/Firmographics rows for the org detail aside, autosaving
// through updateOrgAction. Mirrors OrgSummaryEditPanel's inline-edit style; org has no CAS
// precondition (last-write-wins), so no expectedUpdatedAt is threaded through here either.
export function OrgFirmographicsPanel({
  org,
  onSaved,
  hidden = NONE,
}: OrgFirmographicsPanelProps): React.ReactNode {
  const tContacts = useAppTranslations("contacts");
  const locale = useLocale();
  const format = useFormatters();

  async function save(patch: FirmographicPatch): Promise<Result<unknown, string>> {
    const r = await updateOrgAction({ id: org.id, ...patch }, readCsrfToken());
    onSaved();
    return r.ok ? ok(r.value) : err(r.error.id);
  }

  function saveText(field: "domain" | "industry" | "linkedinUrl", v: string) {
    const trimmed = v.trim();
    return save({ [field]: trimmed === "" ? null : trimmed });
  }

  return (
    <>
      {!hidden.has("domain") && (
        <FieldRow label={tContacts("website")} empty={org.domain === null || org.domain === ""}>
          <InlineTextField
            label={tContacts("website")}
            value={org.domain ?? ""}
            onSave={(v) => saveText("domain", v)}
          />
        </FieldRow>
      )}
      {!hidden.has("linkedinUrl") && (
        <FieldRow
          label={tContacts("linkedin")}
          empty={org.linkedinUrl === null || org.linkedinUrl === ""}
        >
          <InlineTextField
            label={tContacts("linkedin")}
            value={org.linkedinUrl ?? ""}
            onSave={(v) => saveText("linkedinUrl", v)}
          />
        </FieldRow>
      )}
      {!hidden.has("industry") && (
        <FieldRow
          label={tContacts("industry")}
          empty={org.industry === null || org.industry === ""}
        >
          <InlineTextField
            label={tContacts("industry")}
            value={org.industry ?? ""}
            onSave={(v) => saveText("industry", v)}
          />
        </FieldRow>
      )}
      {!hidden.has("annualRevenue") && (
        <FieldRow
          label={tContacts("annualRevenue")}
          empty={org.annualRevenue === null || org.annualRevenue === ""}
        >
          <InlineTextField
            label={tContacts("annualRevenue")}
            formatError={(error) => (error === tContacts("validRevenue") ? error : undefined)}
            value={
              org.annualRevenue == null
                ? ""
                : locale === "en"
                  ? org.annualRevenue
                  : format.number(Number(org.annualRevenue), {
                      useGrouping: false,
                      minimumFractionDigits: org.annualRevenue.split(".")[1]?.length ?? 0,
                      maximumFractionDigits: 2,
                    })
            }
            placeholder={tContacts("addRevenue")}
            onSave={(v) => {
              const trimmed = v.trim();
              if (trimmed === "") return save({ annualRevenue: null });
              const normalized = normalizeNumberInput(trimmed, locale);
              if (normalized === null || !/^\d+(?:\.\d{1,2})?$/.test(normalized))
                return Promise.resolve(err(tContacts("validRevenue")));
              return save({ annualRevenue: normalized });
            }}
          />
        </FieldRow>
      )}
      {!hidden.has("employeeCount") && (
        <FieldRow label={tContacts("employees")} empty={org.employeeCount == null}>
          <InlineTextField
            label={tContacts("employees")}
            formatError={(error) => (error === tContacts("validEmployeeCount") ? error : undefined)}
            value={
              org.employeeCount == null
                ? ""
                : format.number(org.employeeCount, { useGrouping: false })
            }
            placeholder={tContacts("addEmployees")}
            onSave={(v) => {
              const trimmed = v.trim();
              if (trimmed === "") return save({ employeeCount: null });
              const normalized = normalizeNumberInput(trimmed, locale);
              const value = normalized === null ? NaN : Number(normalized);
              if (!Number.isSafeInteger(value) || value < 0)
                return Promise.resolve(err(tContacts("validEmployeeCount")));
              return save({ employeeCount: value });
            }}
          />
        </FieldRow>
      )}
    </>
  );
}
