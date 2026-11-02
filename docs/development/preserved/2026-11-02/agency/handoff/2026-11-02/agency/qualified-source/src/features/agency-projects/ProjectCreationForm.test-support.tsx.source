import { render } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import {
  ProjectCreationForm,
  type ProjectCreationFormProps,
  type ProjectCreationOutcome,
} from "./ProjectCreationForm";

export const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const otherOwnerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const intentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const dealId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const projectId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

export function creationProps(
  overrides: Partial<ProjectCreationFormProps> = {},
): ProjectCreationFormProps {
  return {
    contextKey: "actor-and-crm-context-1",
    draft: {
      contextKey: "actor-and-crm-context-1",
      attempt: null,
      input: {
        intentId,
        ownerUserId: ownerId,
        title: "  Studio Ä / استودیو  ",
        dealId,
        personId: null,
        orgId: null,
      },
    },
    owners: [
      { id: ownerId, label: "Sara رضایی" },
      { id: otherOwnerId, label: "Alex Müller" },
    ],
    contextLabel: "Private CRM context",
    canCreate: true,
    onDraftChange: vi.fn(),
    submit: vi.fn(() => new Promise<ProjectCreationOutcome>(() => undefined)),
    onCreated: vi.fn(),
    ...overrides,
  };
}

export function creationView(props: ProjectCreationFormProps, locale: Locale = "en") {
  return (
    <LocaleProvider locale={locale} numberingSystem="latn" timeZone="UTC">
      <ProjectCreationForm {...props} />
    </LocaleProvider>
  );
}

export function renderCreation(props = creationProps(), locale: Locale = "en") {
  return render(creationView(props, locale));
}

export function ControlledCreationView({
  locale,
  ...props
}: ProjectCreationFormProps & { locale: Locale }) {
  const [draft, setDraft] = useState(props.draft);
  return creationView(
    {
      ...props,
      draft,
      onDraftChange: (next) => {
        setDraft(next);
        props.onDraftChange(next);
      },
    },
    locale,
  );
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
