// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsTemplate } from "@/features/email/emailAuthoringReads";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

type SaveResult = { ok: true; value: { id: string } } | { ok: false; error: { id: string } };
const { createTemplate, createSignature, report, refresh } = vi.hoisted(() => ({
  createTemplate: vi.fn<() => Promise<SaveResult>>(),
  createSignature: vi.fn<() => Promise<SaveResult>>(),
  report: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
// Observe each settings caller's editor name and controlled draft only. TipTap/native speech is separate.
vi.mock("@/features/email/composer/RichTextBodyLazy", () => ({
  RichTextBody: ({
    html,
    ariaLabel,
    onChange,
  }: {
    html: string;
    ariaLabel?: string;
    onChange: (html: string) => void;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={html}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/features/email/authoringActions", () => ({
  createTemplateAction: createTemplate,
  createSignatureAction: createSignature,
  updateTemplateAction: vi.fn(),
  deleteTemplateAction: vi.fn(),
  deleteTemplatesAction: vi.fn(),
  reorderTemplatesAction: vi.fn(),
  updateSignatureAction: vi.fn(),
  deleteSignatureAction: vi.fn(),
  setDefaultSignatureAction: vi.fn(),
}));

import { SignaturesSettingsClient } from "./SignaturesSettingsClient";
import { TemplatesSettingsClient } from "./TemplatesSettingsClient";

const SHARED: SettingsTemplate = {
  id: "shared-1",
  name: "Shared welcome",
  subject: "Welcome",
  bodyHtml: "<p>Shared message</p>",
  isShared: true,
  isOwn: false,
  ownerName: "Ada",
  createdAt: "2026-01-01T12:00:00.000Z",
};
const SIGNATURES = [
  { id: "signature-1", name: "Original signature", bodyHtml: "<p>Original</p>", isDefault: true },
];

beforeEach(() => {
  createTemplate.mockReset().mockResolvedValue({ ok: true, value: { id: "created-template" } });
  createSignature.mockReset().mockResolvedValue({ ok: true, value: { id: "created-signature" } });
  report.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

function showPair(locale: Locale = "en") {
  const S = settingsMessagesForLocale(locale)._email;
  render(
    <LocaleProvider locale={locale}>
      <TemplatesSettingsClient templates={[SHARED]} canShare />
      <SignaturesSettingsClient signatures={SIGNATURES} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: S.newTemplate }));
  fireEvent.click(screen.getByRole("button", { name: S.newSignature }));
  return S;
}

function sectionFor(group: HTMLElement) {
  const section = group.closest("section");
  if (section === null) throw new Error("Expected the editor's existing settings section");
  return within(section);
}

function deferred() {
  let resolve!: (result: SaveResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<SaveResult>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("paired template and signature editor names", () => {
  it.each([
    { locale: "en", templates: "Templates", signatures: "Signatures", body: "Body" },
    { locale: "de", templates: "Vorlagen", signatures: "Signaturen", body: "Nachrichtentext" },
    { locale: "fa", templates: "قالب‌ها", signatures: "امضاها", body: "متن" },
  ] as const)("distinguishes both open editors and their bodies in $locale", (copy) => {
    const S = showPair(copy.locale);
    const templates = screen.getByRole("group", { name: copy.templates });
    const signatures = screen.getByRole("group", { name: copy.signatures });
    const templateBody = within(templates).getByRole("textbox", {
      name: `${copy.templates}: ${copy.body}`,
    });
    const signatureBody = within(signatures).getByRole("textbox", {
      name: `${copy.signatures}: ${copy.body}`,
    });
    fireEvent.change(templateBody, { target: { value: "<p>Template draft</p>" } });
    fireEvent.change(signatureBody, { target: { value: "<p>Signature draft</p>" } });
    expect(templateBody).toHaveValue("<p>Template draft</p>");
    expect(signatureBody).toHaveValue("<p>Signature draft</p>");
    expect(templateBody).not.toBe(signatureBody);
    fireEvent.click(within(templates).getByRole("checkbox", { name: S.shareWithTeam }));
    fireEvent.click(within(signatures).getByRole("checkbox", { name: S.setDefault }));
    expect(within(templates).getByRole("checkbox", { name: S.shareWithTeam })).toBeChecked();
    expect(within(signatures).getByRole("checkbox", { name: S.setDefault })).toBeChecked();
    expect(screen.getByText(S.defaultBadge, { exact: true })).toBeInTheDocument();
    const sharedRow = screen.getByText(SHARED.name, { exact: true }).closest("li");
    if (sharedRow === null) throw new Error("Expected shared template row");
    expect(within(sharedRow).queryByRole("button")).not.toBeInTheDocument();
    expect(within(sharedRow).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(document.documentElement.dir).toBe(copy.locale === "fa" ? "rtl" : "ltr");
    expect(createTemplate).not.toHaveBeenCalled();
    expect(createSignature).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "template", failure: "returned" },
    { kind: "template", failure: "rejected" },
    { kind: "signature", failure: "returned" },
    { kind: "signature", failure: "rejected" },
  ] as const)(
    "preserves named paired drafts through pending $kind save, $failure failure and retry",
    async ({ kind, failure }) => {
      const S = showPair();
      const isTemplate = kind === "template";
      const name = isTemplate ? S.templates : S.signatures;
      const otherName = isTemplate ? S.signatures : S.templates;
      const group = screen.getByRole("group", { name });
      const other = screen.getByRole("group", { name: otherName });
      const target = within(group);
      const body = target.getByRole("textbox", { name: `${name}: ${S.bodyLabel}` });
      const otherBody = within(other).getByRole("textbox", {
        name: `${otherName}: ${S.bodyLabel}`,
      });
      const input = target.getByRole("textbox", { name: S.nameLabel });
      const flag = target.getByRole("checkbox", {
        name: isTemplate ? S.shareWithTeam : S.setDefault,
      });
      const save = target.getByRole("button", { name: S.save });
      const action = isTemplate ? createTemplate : createSignature;
      const otherAction = isTemplate ? createSignature : createTemplate;
      const draftName = `Retain ${kind}`;
      const draftBody = `<p>Retain ${kind} body</p>`;
      fireEvent.change(input, { target: { value: draftName } });
      fireEvent.change(body, { target: { value: draftBody } });
      fireEvent.change(otherBody, { target: { value: "<p>Other editor draft</p>" } });
      fireEvent.click(flag);
      if (isTemplate) {
        fireEvent.change(target.getByRole("textbox", { name: S.subjectLabel }), {
          target: { value: "Retained subject" },
        });
      }
      const payload = isTemplate
        ? { name: draftName, subject: "Retained subject", bodyHtml: draftBody, isShared: true }
        : { name: draftName, bodyHtml: draftBody, isDefault: true };
      const failed = deferred();
      action.mockReturnValueOnce(failed.promise);
      fireEvent.click(save);
      fireEvent.click(save);
      expect(action).toHaveBeenCalledExactlyOnceWith("csrf", payload);
      expect(group).toBeDisabled();
      expect(group).toHaveAttribute("inert");
      expect(input).toBeDisabled();
      expect(body).toBeDisabled();
      expect(save).toBeDisabled();
      expect(flag).toBeDisabled();
      expect(target.getByRole("button", { name: S.cancel })).toBeDisabled();
      expect(other).not.toBeDisabled();
      expect(otherBody).toBeEnabled();
      await act(async () => {
        if (failure === "returned") failed.resolve({ ok: false, error: { id: "E_PERM_001" } });
        else failed.reject(new Error("private authoring transport diagnostic"));
        await failed.promise.catch(() => undefined);
      });
      await waitFor(() => expect(save).toBeEnabled());
      expect(sectionFor(group).getByRole("alert")).toHaveTextContent(
        settingsMessagesForLocale("en")._errors.generic,
      );
      expect(input).toHaveValue(draftName);
      expect(body).toHaveValue(draftBody);
      expect(flag).toBeChecked();
      expect(otherBody).toHaveValue("<p>Other editor draft</p>");
      expect(screen.queryByText("private authoring transport diagnostic")).not.toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
      const retry = deferred();
      action.mockReturnValueOnce(retry.promise);
      fireEvent.click(save);
      fireEvent.click(save);
      expect(action).toHaveBeenCalledTimes(2);
      expect(action).toHaveBeenNthCalledWith(2, "csrf", payload);
      expect(body).toBeDisabled();
      await act(async () => {
        retry.resolve({ ok: true, value: { id: `created-${kind}` } });
        await retry.promise;
      });
      expect(screen.queryByRole("group", { name })).not.toBeInTheDocument();
      expect(screen.getByRole("group", { name: otherName })).toBe(other);
      expect(otherBody).toHaveValue("<p>Other editor draft</p>");
      expect(otherAction).not.toHaveBeenCalled();
      expect(action).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );
});
