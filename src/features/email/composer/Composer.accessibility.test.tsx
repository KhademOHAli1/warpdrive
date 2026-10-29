// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { Composer } from "./Composer";
import "./RichTextBody";

afterEach(cleanup);

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ email: { templates: { list: { invalidate: () => undefined } } } }),
    email: {
      templates: {
        list: { useQuery: () => ({ data: [] }) },
        get: { useQuery: () => ({ data: undefined }) },
      },
      mergeContext: { useQuery: () => ({ data: {}, isPending: false }) },
      signatures: { list: { useQuery: () => ({ data: [] }) } },
    },
    contacts: { listPeople: { useQuery: () => ({ data: { rows: [], total: 0 } }) } },
    activities: { listTypes: { useQuery: () => ({ data: [] }) } },
  },
}));
vi.mock("@/features/email/actions", () => ({
  sendEmail: () => Promise.resolve({ ok: true }),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("../folderActions", () => ({
  saveDraftAction: () => Promise.resolve({ ok: true, value: { id: "draft-stub" } }),
  deleteDraftAction: () => Promise.resolve({ ok: true }),
}));
vi.mock("@/features/activities/actions", () => ({
  createActivityAction: () => Promise.resolve({ ok: true, value: { id: "act-stub" } }),
  completeActivityAction: () => Promise.resolve({ ok: true, value: { id: "act-stub" } }),
}));
vi.mock("@/features/files/serverActions", () => ({
  requestUploadAction: () =>
    Promise.resolve({
      ok: true,
      value: { fileId: "f1", post: { url: "https://fake/up", fields: {} } },
    }),
  confirmUploadAction: () => Promise.resolve({ ok: true }),
}));

const cases = [
  { locale: "en", subjectLabel: "Subject", bodyLabel: "email body" },
  { locale: "fa", subjectLabel: "موضوع", bodyLabel: "متن ایمیل" },
] as const;

describe.each(cases)(
  "$locale email composer accessible fields",
  ({ locale, subjectLabel, bodyLabel }) => {
    it("keeps the subject's localized name after text is entered", () => {
      render(
        <LocaleProvider locale={locale}>
          <Composer accountId="a1" context={{ kind: "inbox" }} />
        </LocaleProvider>,
      );
      const subject = screen.getByPlaceholderText(subjectLabel);

      fireEvent.change(subject, { target: { value: "Quarterly proposal" } });

      expect(subject).toHaveValue("Quarterly proposal");
      expect(screen.getByRole("textbox", { name: subjectLabel })).toBe(subject);
      expect(subject).toHaveAccessibleName(subjectLabel);
    });

    it("names the filled editable body itself, with multiline textbox semantics", async () => {
      render(
        <LocaleProvider locale={locale}>
          <Composer
            accountId="a1"
            context={{ kind: "inbox" }}
            prefill={{ bodyHtml: "<p>Existing draft content</p>" }}
          />
        </LocaleProvider>,
      );

      const body = await screen.findByRole("textbox", { name: bodyLabel });

      expect(body).toHaveAttribute("contenteditable", "true");
      expect(body).toHaveAttribute("aria-multiline", "true");
      expect(body).toHaveTextContent("Existing draft content");
      expect(body).toHaveAccessibleName(bodyLabel);
    });
  },
);
