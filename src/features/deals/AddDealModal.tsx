"use client";
import type React from "react";
import { useMemo, useState } from "react";
import { HiddenRecordNotice } from "@/components/HiddenRecordNotice";
import { useCompanyCurrency } from "@/features/currencies/CurrencyProvider";
import {
  CustomFieldCreateFields,
  customFieldCreatePayload,
} from "@/features/custom-fields/CustomFieldCreateFields";
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
import { AddDealLeftColumn } from "./AddDealLeftColumn";
import { type AddDealState, initialAddDealState } from "./addDealState";
import { addDealCustomFieldError } from "./addDealValidation";
import { deriveEntityTitle } from "./dealTitleAutofill";
import { createDealOrgAction, createDealPersonAction } from "./nativeContactActions";
import { nativeDealCreateEnvelopeV1 } from "./nativeCreateIntentV1";
import { parseNewDeal } from "./newDealForm";
import { clearRetainedCreation, retainCreation } from "./retainedCreation";
import { type PreparedDealCreation, useNativeDealCreation } from "./useNativeDealCreation";

interface Option {
  id: string;
  name: string;
}
interface PipelineOption extends Option {
  stages: Option[];
}
function contactFailure(value: string | null | { error: string }): value is { error: string } {
  return value !== null && typeof value === "object";
}

export interface AddDealModalProps {
  pipelineId: string;
  pipelines: PipelineOption[];
  baseCurrency?: string;
  // Optional initial stage (per-stage "+" add button). Defaults to the pipeline's first stage.
  stageId?: string;
  // Optional initial title (inbox sidebar seeds this from the thread subject). Locks title autofill.
  prefillTitle?: string;
  onClose: () => void;
  // Receives the new deal's id and (validated, post-trim) title so a caller can auto-link and
  // display it without a second fetch (inbox sidebar, compose-time link sidebar); existing
  // callers that pass a zero-arg refresh handler stay assignable (a function may ignore
  // trailing parameters).
  onCreated: (id: string, title: string) => void | Promise<void>;
  // Skip the "jump to /deals/:id after create" navigation even when the user's
  // openDetailsAfterCreate.leadDeal preference is on. Defaults to false so every existing
  // caller keeps navigating. Set true by callers whose surface would be abandoned by a
  // full-page nav away, e.g. the inbox compose link sidebar (ComposeLinkSidebar): the deal
  // link is only local state there until the email is sent, so navigating away loses it.
  suppressDetailNav?: boolean;
}

export function AddDealModal(props: AddDealModalProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const locale = useLocale();

  const companyCurrency = useCompanyCurrency();
  const { pipelineId, pipelines, baseCurrency = companyCurrency, stageId, prefillTitle } = props;
  const { onClose, onCreated, suppressDetailNav = false } = props;
  const [currencyDraft, setCurrency] = useState(baseCurrency);
  const { autoPrefixLeadDealTitles, openDetailsAfterCreate } = useInterfacePrefs();
  const firstStage = pipelines.find((p) => p.id === pipelineId)?.stages[0]?.id ?? "";
  const hasPrefillTitle = prefillTitle !== undefined && prefillTitle.trim() !== "";
  const [stateDraft, setState] = useState<AddDealState>(() => {
    const base = initialAddDealState(pipelineId, stageId ?? firstStage);
    return hasPrefillTitle ? { ...base, title: prefillTitle } : base;
  });
  const [valueLocaleDraft, setValueLocale] = useState(locale);
  const creation = useNativeDealCreation({
    onCreated,
    onClose,
    openDetails: openDetailsAfterCreate.leadDeal,
    suppressDetailNav,
    restoreForm: (form, savedCurrency, savedLocale) => {
      setState(form);
      setCurrency(savedCurrency);
      setValueLocale(savedLocale);
      setTitleEdited(true);
    },
  });
  const { operation, pending, error, setError, hiddenTitle } = creation;
  const state = operation?.form ?? stateDraft;
  const currency = operation?.currency ?? currencyDraft;
  const valueLocale = operation?.valueLocale ?? valueLocaleDraft;

  const peopleQ = trpc.contacts.personOptions.useQuery();
  const orgsQ = trpc.contacts.orgOptions.useQuery();
  // Manager-only lists: on a 403 the data stays undefined and the field is hidden.
  const usersQ = trpc.identity.listUsers.useQuery(undefined, { retry: false });
  const groupsQ = trpc.identity.listVisibilityGroups.useQuery(undefined, { retry: false });
  const dealFieldsQ = trpc.customFields.listDefs.useQuery({ target: "deal" });
  const personFieldsQ = trpc.customFields.listDefs.useQuery({ target: "person" });
  const orgFieldsQ = trpc.customFields.listDefs.useQuery({ target: "organization" });

  const set = (patch: Partial<AddDealState>): void => {
    if (operation !== null || creation.actorId === null) return;
    // An unfinished amount keeps its input convention when the interface language changes.
    if (patch.value !== undefined && state.value.trim() === "") setValueLocale(locale);
    setState((s) => ({ ...s, ...patch }));
  };

  // Autofill the title from the chosen person/org ("{name} deal") until the user edits it
  // themselves. Mirrors the derived value into state so submit uses it. `titleEdited` locks it once
  // the user types their own title.
  const people = peopleQ.data ?? [];
  const orgs = orgsQ.data ?? [];
  // A prefilled title (inbox subject) counts as user-set, so the person/org autofill never clobbers it.
  const [titleEdited, setTitleEdited] = useState(hasPrefillTitle);
  const derivedTitle = deriveEntityTitle(
    state,
    orgs,
    people,
    "deal",
    autoPrefixLeadDealTitles,
    (name) => translateSales("computed.defaultDealTitle", { name }),
  );
  // Derived during render: an effect would paint the stale title for a frame, then correct it.
  if (operation === null && !titleEdited && state.title !== derivedTitle) {
    setState((s) => (s.title === derivedTitle ? s : { ...s, title: derivedTitle }));
  }

  const stages = useMemo(
    () => pipelines.find((p) => p.id === state.pipelineId)?.stages ?? [],
    [pipelines, state.pipelineId],
  );

  async function prepare(id: string): Promise<PreparedDealCreation | null> {
    const expectedActorId = creation.actorId;
    if (expectedActorId === null) return null;
    const csrf = readCsrfToken();
    // Validate the deal fields BEFORE creating any inline org/person, so an invalid deal (e.g.
    // blank title) can never leave an orphaned org/person behind or duplicate one on retry.
    const parsed = parseNewDeal(
      {
        title: state.title,
        stageId: state.stageId,
        value: state.value,
        personId: null,
        orgId: null,
        labels: state.labels,
        sourceChannel: state.sourceChannel,
        sourceChannelId: state.sourceChannelId,
        expectedCloseDate: state.expectedCloseDate,
        ownerId: state.ownerId,
      },
      state.pipelineId,
      locale,
      valueLocale,
    );
    if (!parsed.ok) {
      setError(parsed.error);
      return null;
    }
    const dealFields = dealFieldsQ.data ?? [];
    const personFields = personFieldsQ.data ?? [];
    const orgFields = orgFieldsQ.data ?? [];
    const invalidCustomField = addDealCustomFieldError(
      state,
      { dealFields, personFields, orgFields },
      locale,
      (name) => translateSales("computed.requiredField", { name }),
    );
    if (invalidCustomField !== null) {
      setError(invalidCustomField);
      return null;
    }
    let submitState: AddDealState = {
      ...state,
      dealCustomFields: customFieldCreatePayload(dealFields, state.dealCustomFields),
      personCustomFields: customFieldCreatePayload(personFields, state.personCustomFields),
      orgCustomFields: customFieldCreatePayload(orgFields, state.orgCustomFields),
    };
    const rememberContacts = (next: AddDealState) => {
      submitState = next;
      if (creation.isCurrent()) setState(next);
    };
    let contact: "org" | "person" = "org";
    const hold = (phase: "contact_pending" | "contact_unknown" | "contact_rejected") => {
      if (creation.actorId !== null)
        retainCreation({
          id,
          actorId: creation.actorId,
          form: submitState,
          currency,
          valueLocale,
          contact,
          phase,
        });
    };
    let orgId: string | null;
    let personId: string | null;
    try {
      if (submitState.orgMode === "new") hold("contact_pending");
      const org = await resolveNewOrgId(submitState, csrf, locale, (input, token) =>
        createDealOrgAction(expectedActorId, input, token ?? null),
      );
      if (contactFailure(org)) {
        hold("contact_rejected");
        if (creation.isCurrent()) setError(org.error);
        return null;
      }
      orgId = org;
      rememberContacts({ ...submitState, orgMode: "existing", orgId: orgId ?? "", newOrgName: "" });
      contact = "person";
      if (submitState.personMode === "new") hold("contact_pending");
      const person = await resolveNewPersonId(submitState, orgId, csrf, locale, (input, token) =>
        createDealPersonAction(expectedActorId, input, token ?? null),
      );
      if (contactFailure(person)) {
        hold("contact_rejected");
        if (creation.isCurrent()) setError(person.error);
        return null;
      }
      personId = person;
      rememberContacts({
        ...submitState,
        personMode: "existing",
        personId: personId ?? "",
        newPersonName: "",
      });
    } catch {
      hold("contact_unknown");
      return null;
    }
    if (!creation.isCurrent()) {
      hold("contact_rejected");
      return null;
    }
    const resolved = {
      ...parsed.input,
      currency,
      personId,
      orgId,
      customFields: submitState.dealCustomFields,
    };
    const input =
      state.visibilityGroupId === ""
        ? resolved
        : { ...resolved, visibilityGroupId: state.visibilityGroupId };
    const normalized = nativeDealCreateEnvelopeV1.safeParse({
      protocolVersion: 1,
      expectedActorId: creation.actorId,
      creationOperationId: id,
      deal: input,
    });
    if (!normalized.success) {
      clearRetainedCreation(expectedActorId, id);
      setError(translateSales("nativeCreate.invalid"));
      return null;
    }
    return { form: submitState, currency, valueLocale, deal: normalized.data.deal };
  }

  if (hiddenTitle !== null) {
    return <HiddenRecordNotice entityLabel="Deal" title={hiddenTitle} onDismiss={onClose} />;
  }

  return (
    <EntityCreateModalShell
      title={translateSales("add_deal_cdcda")}
      personMode={state.personMode}
      phones={state.phones}
      emails={state.emails}
      onPhones={(phones) => set({ phones })}
      onEmails={(emails) => set({ emails })}
      personCustomFields={
        <CustomFieldCreateFields
          title={translateSales("person_fields_31c77")}
          currency={baseCurrency}
          defs={personFieldsQ.data ?? []}
          values={state.personCustomFields}
          onChange={(key, value) =>
            set({ personCustomFields: { ...state.personCustomFields, [key]: value } })
          }
        />
      }
      error={error}
      pending={
        pending || operation?.phase === "contact_pending" || operation?.phase === "submitting"
      }
      fieldsDisabled={operation !== null || pending || creation.actorId === null}
      submitLabel={creation.submitLabel}
      submitDisabled={
        creation.actorId === null ||
        dealFieldsQ.isLoading ||
        personFieldsQ.isLoading ||
        orgFieldsQ.isLoading
      }
      onSubmit={() => void creation.submit(prepare)}
      onClose={onClose}
      leftColumn={
        <AddDealLeftColumn
          state={state}
          set={set}
          onTitleChange={(v) => {
            setTitleEdited(true);
            set({ title: v });
          }}
          people={peopleQ.data ?? []}
          orgs={orgsQ.data ?? []}
          pipelines={pipelines}
          stages={stages}
          owners={optionsOrNull(usersQ.data)}
          groups={optionsOrNull(groupsQ.data)}
          baseCurrency={baseCurrency}
          currency={currency}
          onCurrencyChange={(value) => {
            if (operation === null) setCurrency(value);
          }}
          organizationCustomFields={
            <CustomFieldCreateFields
              title={translateSales("organization_fields_805c7")}
              currency={baseCurrency}
              defs={orgFieldsQ.data ?? []}
              values={state.orgCustomFields}
              onChange={(key, value) =>
                set({ orgCustomFields: { ...state.orgCustomFields, [key]: value } })
              }
            />
          }
          dealCustomFields={
            <CustomFieldCreateFields
              title={translateSales("deal_fields_930ee")}
              currency={baseCurrency}
              defs={dealFieldsQ.data ?? []}
              values={state.dealCustomFields}
              onChange={(key, value) =>
                set({ dealCustomFields: { ...state.dealCustomFields, [key]: value } })
              }
            />
          }
        />
      }
    />
  );
}
