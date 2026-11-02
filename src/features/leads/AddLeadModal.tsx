"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { HiddenRecordNotice } from "@/components/HiddenRecordNotice";
import { useCompanyCurrency } from "@/features/currencies/CurrencyProvider";
import {
  CustomFieldCreateFields,
  customFieldCreateError,
  customFieldCreatePayload,
  firstMissingImportantField,
} from "@/features/custom-fields/CustomFieldCreateFields";
import { deriveEntityTitle } from "@/features/deals/dealTitleAutofill";
import { EntityCreateModalShell } from "@/features/entity-create/EntityCreateModalShell";
import {
  optionsOrNull,
  resolveNewOrgId,
  resolveNewPersonId,
} from "@/features/entity-create/modalHelpers";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useInterfacePrefs } from "@/features/identity/InterfacePrefsProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { AddLeadLeftColumn } from "./AddLeadLeftColumn";
import { type AddLeadState, initialAddLeadState } from "./addLeadState";
import { parseNewLead } from "./leadForm";
import { createLeadAction } from "./leadServerActions";

export interface AddLeadModalProps {
  baseCurrency?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function AddLeadModal({
  baseCurrency: initialCurrency,
  onClose,
  onCreated,
}: AddLeadModalProps): React.ReactNode {
  const companyCurrency = useCompanyCurrency();
  const baseCurrency = initialCurrency ?? companyCurrency;
  const tLeads = useAppTranslations("leads");
  const locale = useLocale();
  const [currency, setCurrency] = useState(baseCurrency);

  const router = useRouter();
  const { autoPrefixLeadDealTitles, openDetailsAfterCreate } = useInterfacePrefs();
  const [state, setState] = useState<AddLeadState>(initialAddLeadState());
  const [valueLocale, setValueLocale] = useState(locale);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hiddenTitle, setHiddenTitle] = useState<string | null>(null);

  const peopleQ = trpc.contacts.personOptions.useQuery();
  const orgsQ = trpc.contacts.orgOptions.useQuery();
  const usersQ = trpc.identity.listUsers.useQuery(undefined, { retry: false });
  const groupsQ = trpc.identity.listVisibilityGroups.useQuery(undefined, { retry: false });
  const personFieldsQ = trpc.customFields.listDefs.useQuery({ target: "person" });
  const orgFieldsQ = trpc.customFields.listDefs.useQuery({ target: "organization" });
  const leadFieldsQ = trpc.customFields.listDefs.useQuery({ target: "lead" });

  const set = (patch: Partial<AddLeadState>): void => {
    // An unfinished amount keeps its input convention when the interface language changes.
    if (patch.value !== undefined && state.value.trim() === "") setValueLocale(locale);
    setState((s) => ({ ...s, ...patch }));
  };

  // Autofill the lead title from the chosen person/org ("{name} lead") until the user edits it.
  const people = peopleQ.data ?? [];
  const orgs = orgsQ.data ?? [];
  const [titleEdited, setTitleEdited] = useState(false);
  const derivedTitle = deriveEntityTitle(
    state,
    orgs,
    people,
    "lead",
    autoPrefixLeadDealTitles,
    (name) => tLeads("defaultLeadTitle", { name }),
  );
  // Derived during render: an effect would paint the stale title for a frame, then correct it.
  if (!titleEdited && state.title !== derivedTitle) {
    setState((s) => (s.title === derivedTitle ? s : { ...s, title: derivedTitle }));
  }

  function validateCreateFields(): string | null {
    return (
      customFieldCreateError(leadFieldsQ.data ?? [], state.leadCustomFields, locale) ??
      (state.orgMode === "new"
        ? customFieldCreateError(orgFieldsQ.data ?? [], state.orgCustomFields, locale)
        : null) ??
      (state.personMode === "new"
        ? customFieldCreateError(personFieldsQ.data ?? [], state.personCustomFields, locale)
        : null)
    );
  }

  function finishCreation(created: { id: string } | null, title: string): void {
    onCreated();
    if (created === null) {
      setHiddenTitle(title);
      return;
    }
    onClose();
    if (openDetailsAfterCreate.leadDeal) router.push(`/leads/${created.id}`);
  }

  async function submit(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const csrf = readCsrfToken();
      // Validate the lead fields BEFORE creating any inline org/person, so an invalid lead (e.g.
      // blank title) can never leave an orphaned org/person behind or duplicate one on retry.
      const parsed = parseNewLead(
        {
          title: state.title,
          value: state.value,
          personId: null,
          orgId: null,
          labels: state.labels,
          sourceChannel: state.sourceChannel,
          sourceChannelId: state.sourceChannelId,
          expectedCloseDate: state.expectedCloseDate,
          ownerId: state.ownerId,
          visibilityGroupId: state.visibilityGroupId,
        },
        locale,
        valueLocale,
      );
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const leadFields = leadFieldsQ.data ?? [];
      const missingLeadField = firstMissingImportantField(leadFields, state.leadCustomFields);
      if (missingLeadField !== null) {
        setError(tLeads("fieldRequired", { name: missingLeadField.name }));
        return;
      }
      const personFields = personFieldsQ.data ?? [];
      const orgFields = orgFieldsQ.data ?? [];
      if (state.orgMode === "new") {
        const missingOrgField = firstMissingImportantField(orgFields, state.orgCustomFields);
        if (missingOrgField !== null) {
          setError(tLeads("fieldRequired", { name: missingOrgField.name }));
          return;
        }
      }
      if (state.personMode === "new") {
        const missingPersonField = firstMissingImportantField(
          personFields,
          state.personCustomFields,
        );
        if (missingPersonField !== null) {
          setError(tLeads("fieldRequired", { name: missingPersonField.name }));
          return;
        }
      }
      const customError = validateCreateFields();
      if (customError !== null) {
        setError(customError);
        return;
      }
      const submitState = {
        ...state,
        personCustomFields: customFieldCreatePayload(personFields, state.personCustomFields),
        orgCustomFields: customFieldCreatePayload(orgFields, state.orgCustomFields),
      };
      const orgId = await resolveNewOrgId(submitState, csrf, locale);
      if (orgId !== null && typeof orgId === "object") {
        setError(orgId.error);
        return;
      }
      const personId = await resolveNewPersonId(submitState, orgId, csrf, locale);
      if (personId !== null && typeof personId === "object") {
        setError(personId.error);
        return;
      }
      const result = await createLeadAction(
        {
          ...parsed.input,
          currency,
          personId,
          orgId,
          customFields: customFieldCreatePayload(leadFields, state.leadCustomFields),
        },
        csrf,
      );
      if (!result.ok) {
        setError(tLeads("createError", { errorId: result.error.id }));
        return;
      }
      // "Open details view after creating a new item" (personal preference): leads share the
      // lead/deal flag with deals. Otherwise the caller's onCreated handles the refresh.
      finishCreation(result.value, parsed.input.title);
    } finally {
      setPending(false);
    }
  }

  if (hiddenTitle !== null) {
    return <HiddenRecordNotice entityLabel="Lead" title={hiddenTitle} onDismiss={onClose} />;
  }

  return (
    <EntityCreateModalShell
      title={tLeads("addLead")}
      personMode={state.personMode}
      phones={state.phones}
      emails={state.emails}
      onPhones={(phones) => set({ phones })}
      onEmails={(emails) => set({ emails })}
      personCustomFields={
        <CustomFieldCreateFields
          title={tLeads("personFields")}
          currency={baseCurrency}
          defs={personFieldsQ.data ?? []}
          values={state.personCustomFields}
          onChange={(key, value) =>
            set({ personCustomFields: { ...state.personCustomFields, [key]: value } })
          }
        />
      }
      error={error}
      pending={pending}
      submitDisabled={personFieldsQ.isLoading || orgFieldsQ.isLoading || leadFieldsQ.isLoading}
      onSubmit={() => void submit()}
      onClose={onClose}
      leftColumn={
        <AddLeadLeftColumn
          state={state}
          set={set}
          onTitleChange={(v) => {
            setTitleEdited(true);
            set({ title: v });
          }}
          people={peopleQ.data ?? []}
          orgs={orgsQ.data ?? []}
          owners={optionsOrNull(usersQ.data)}
          groups={optionsOrNull(groupsQ.data)}
          baseCurrency={baseCurrency}
          currency={currency}
          onCurrencyChange={setCurrency}
          organizationCustomFields={
            <CustomFieldCreateFields
              title={tLeads("organizationFields")}
              currency={baseCurrency}
              defs={orgFieldsQ.data ?? []}
              values={state.orgCustomFields}
              onChange={(key, value) =>
                set({ orgCustomFields: { ...state.orgCustomFields, [key]: value } })
              }
            />
          }
          leadCustomFields={
            <CustomFieldCreateFields
              title={tLeads("leadFields")}
              currency={baseCurrency}
              defs={leadFieldsQ.data ?? []}
              values={state.leadCustomFields}
              onChange={(key, value) =>
                set({ leadCustomFields: { ...state.leadCustomFields, [key]: value } })
              }
            />
          }
        />
      }
    />
  );
}
