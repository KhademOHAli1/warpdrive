"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { reportTimePickerValidity } from "@/components/ui/timePickerValidity";
import { createOrgAction, createPersonAction } from "@/features/contacts/actions";
import { cleanAddress, nonEmptyPoints } from "@/features/contacts/EditContactForms";
import {
  CustomFieldCreateFields,
  customFieldCreateError,
  customFieldCreatePayload,
} from "@/features/custom-fields/CustomFieldCreateFields";
import { AddDealPersonColumn, type ContactPoint } from "@/features/deals/AddDealPersonColumn";
import { EntityCreateDialogShell } from "@/features/entity-create/EntityCreateDialogShell";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useInterfacePrefs } from "@/features/identity/InterfacePrefsProvider";
import { saveErrorMessage } from "@/features/inline-edit/saveError";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";

type ContactKind = "person" | "org";
type AfterCreateBehavior = "respect-interface-preference" | "stay";

export interface ContactCreateModalProps {
  onClose: () => void;
  onCreated: (id: string) => void;
  initialName?: string;
  initialEmail?: string;
  afterCreate?: AfterCreateBehavior;
}

interface GlobalContactModalProps extends ContactCreateModalProps {
  kind: ContactKind;
}

const ADDRESS_FIELDS = ["street", "city", "region", "postal", "country"] as const;

// Compatibility entry point for the global quick-add menu. List and embedded surfaces use the
// explicit variants below so their intent is visible without branching props at the call site.
export function GlobalContactModal(props: GlobalContactModalProps): React.ReactNode {
  const { kind, ...modalProps } = props;
  return kind === "person" ? (
    <PersonCreateModal {...modalProps} />
  ) : (
    <OrganizationCreateModal {...modalProps} />
  );
}

export function PersonCreateModal(props: ContactCreateModalProps): React.ReactNode {
  return <ContactCreateModal kind="person" {...props} />;
}

export function OrganizationCreateModal(props: ContactCreateModalProps): React.ReactNode {
  return <ContactCreateModal kind="org" {...props} />;
}

// Person and organization creation now use the same dialog frame as Add lead/Add deal. The two
// variants share persistence and navigation behavior but compose their own field columns.
function ContactCreateModal({
  kind,
  onClose,
  onCreated,
  initialName = "",
  initialEmail = "",
  afterCreate = "respect-interface-preference",
}: GlobalContactModalProps): React.ReactNode {
  const t = useAppTranslations("quickAdd");
  const locale = useLocale();
  const router = useRouter();
  const { openDetailsAfterCreate } = useInterfacePrefs();
  const nameId = useId();
  const addressId = useId();
  const [name, setName] = useState(initialName);
  const [emails, setEmails] = useState<ContactPoint[]>(() => {
    const email = initialEmail.trim();
    return email === "" ? [] : [{ label: "Work", value: email, primary: true }];
  });
  const [phones, setPhones] = useState<ContactPoint[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [address, setAddress] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const orgQ = trpc.contacts.orgOptions.useQuery(undefined, { enabled: kind === "person" });
  const customFieldsQ = trpc.customFields.listDefs.useQuery({
    target: kind === "person" ? "person" : "organization",
  });
  const orgOptions = orgQ.data ?? [];

  async function submit(): Promise<void> {
    // The ref closes the same-tick window before React commits pending=true. This keeps Enter and
    // the Save button on the same guarded path and prevents duplicate creates on rapid input.
    if (submitting.current || pending || customFieldsQ.isLoading) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setError(t("nameRequired"));
      return;
    }
    const defs = customFieldsQ.data ?? [];
    const fieldError = customFieldCreateError(defs, customFields, locale);
    if (fieldError !== null) {
      setError(fieldError);
      return;
    }
    const submittedCustomFields = customFieldCreatePayload(defs, customFields);

    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const csrf = readCsrfToken();
      const result =
        kind === "person"
          ? await createPersonAction(
              {
                name: trimmed,
                emails: nonEmptyPoints(emails),
                phones: nonEmptyPoints(phones),
                orgId: selectedOrgId === "" ? null : selectedOrgId,
                customFields: submittedCustomFields,
              },
              csrf,
            )
          : await createOrgAction(
              {
                name: trimmed,
                address: cleanAddress(address),
                customFields: submittedCustomFields,
              },
              csrf,
            );

      if (!result.ok) {
        setError(saveErrorMessage(result.error.id, locale));
        return;
      }

      onCreated(result.value.id);
      onClose();
      if (afterCreate === "stay") return;

      const openDetails =
        kind === "person" ? openDetailsAfterCreate.person : openDetailsAfterCreate.org;
      if (openDetails) {
        router.push(
          kind === "person"
            ? `/contacts/people/${result.value.id}`
            : `/contacts/orgs/${result.value.id}`,
        );
      } else {
        router.refresh();
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <EntityCreateDialogShell
      title={kind === "person" ? t("addPerson") : t("addOrganization")}
      bodyClassName="grid gap-6 md:grid-cols-[1.4fr_1fr]"
      error={error}
      pending={pending}
      submitDisabled={customFieldsQ.isLoading}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <div className="min-w-0 space-y-4">
        <div className="space-y-1">
          <label htmlFor={nameId} className="block text-sm font-medium">
            {t("name")}
          </label>
          <Input
            id={nameId}
            autoFocus
            required
            maxLength={255}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (reportTimePickerValidity(event.currentTarget.closest('[role="dialog"]')))
                  void submit();
              }
            }}
          />
        </div>

        {kind === "person" && (
          <div className="space-y-1">
            <span className="block text-sm font-medium">{t("organization")}</span>
            <Select
              ariaLabel={t("organization")}
              value={selectedOrgId}
              onChange={setSelectedOrgId}
              placeholder={t("noOrganization")}
              options={[
                { value: "", label: t("noOrganization") },
                ...orgOptions.map<SelectOption>((option) => ({
                  value: option.id,
                  label: option.name,
                })),
              ]}
              triggerClassName="min-h-9"
            />
          </div>
        )}

        <CustomFieldCreateFields
          defs={customFieldsQ.data ?? []}
          values={customFields}
          onChange={(key, value) => setCustomFields((current) => ({ ...current, [key]: value }))}
        />
      </div>

      <div className="min-w-0">
        {kind === "person" ? (
          <AddDealPersonColumn
            disabled={false}
            phones={phones}
            emails={emails}
            onPhones={setPhones}
            onEmails={setEmails}
          />
        ) : (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("address")}
            </legend>
            {ADDRESS_FIELDS.map((key) => {
              const id = `${addressId}-${key}`;
              return (
                <div key={key} className="space-y-1">
                  <label htmlFor={id} className="block text-sm font-medium">
                    {t(`addressFields.${key}`)}
                  </label>
                  <Input
                    id={id}
                    value={address[key] ?? ""}
                    onChange={(event) =>
                      setAddress((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                </div>
              );
            })}
          </fieldset>
        )}
      </div>
    </EntityCreateDialogShell>
  );
}
