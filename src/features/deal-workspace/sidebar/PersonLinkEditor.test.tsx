// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { CustomFieldDef } from "@/types/customFields";
import { PersonLinkEditor } from "./PersonLinkEditor";
import type { PersonMatchReason } from "./personMatch";

type LinkResult = { ok: true } | { ok: false; error: { id: string } };
const { createPerson, updateDeal } = vi.hoisted(() => ({
  createPerson: vi.fn<(...args: unknown[]) => Promise<{ ok: true; value: { id: string } }>>(() =>
    Promise.resolve({ ok: true, value: { id: "created-person" } }),
  ),
  updateDeal: vi.fn<(...args: unknown[]) => Promise<LinkResult>>(() =>
    Promise.resolve({ ok: true }),
  ),
}));
vi.mock("@/features/contacts/actions", () => ({ createPersonAction: createPerson }));
vi.mock("@/features/deals/updateAction", () => ({ updateDealAction: updateDeal }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const candidate = {
  id: "existing-person",
  name: "Ali (تهران)",
  emails: ["ali@example.com"],
  phones: ["+98 912 000 0000"],
};
const requiredField: CustomFieldDef = {
  id: "customer-id-field",
  targetEntity: "person",
  type: "text",
  name: "شناسه مشتری / Customer ID",
  key: "customer_id",
  options: [],
  isRequired: false,
  isImportant: true,
  showInAddForm: true,
  order: 0,
  archivedAt: null,
};

function renderEditor(locale: Locale, customFieldDefs: CustomFieldDef[] = []) {
  const onDone = vi.fn();
  const onError = vi.fn();
  render(
    <LocaleProvider locale={locale}>
      <PersonLinkEditor
        dealId="deal-1"
        expectedUpdatedAt="2027-03-21T00:00:00Z"
        personOptions={[candidate]}
        hidden={new Set()}
        customFieldDefs={customFieldDefs}
        onDone={onDone}
        onError={onError}
      />
    </LocaleProvider>,
  );
  return { onDone, onError };
}

it.each<{ locale: Locale; reason: PersonMatchReason; hint: string }>([
  { locale: "en", reason: "email", hint: "Ali (تهران) already has this email" },
  { locale: "en", reason: "phone", hint: "Ali (تهران) already has this phone" },
  { locale: "en", reason: "name", hint: "Ali (تهران) has a similar name" },
  { locale: "fa", reason: "email", hint: "این نشانی ایمیل برای Ali (تهران) ثبت شده است." },
  { locale: "fa", reason: "phone", hint: "این شماره تلفن برای Ali (تهران) ثبت شده است." },
  { locale: "fa", reason: "name", hint: "فردی با نام مشابه پیدا شد: Ali (تهران)" },
])(
  "explains the $locale $reason match and links it without creating a duplicate",
  async ({ locale, reason, hint }) => {
    const { onDone } = renderEditor(locale);
    const label =
      reason === "email"
        ? locale === "fa"
          ? "ایمیل"
          : "Email"
        : reason === "phone"
          ? locale === "fa"
            ? "تلفن"
            : "Phone"
          : locale === "fa"
            ? "نام"
            : "First name";
    const value =
      reason === "email" ? candidate.emails[0] : reason === "phone" ? candidate.phones[0] : "Ali";
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(screen.getByRole("listitem")).toHaveTextContent(hint);
    const name = screen.getByText(candidate.name);
    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "auto");
    fireEvent.click(screen.getByRole("button", { name: locale === "fa" ? "مرتبط کردن" : "Link" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(updateDeal).toHaveBeenCalledWith(
      { dealId: "deal-1", expectedUpdatedAt: "2027-03-21T00:00:00Z", personId: candidate.id },
      "csrf",
    );
    expect(createPerson).not.toHaveBeenCalled();
  },
);

it.each<Locale>(["en", "fa"])(
  "validates an important field in %s before creating or linking",
  async (locale) => {
    renderEditor(locale, [requiredField]);
    fireEvent.change(screen.getByLabelText(locale === "fa" ? "نام" : "First name"), {
      target: { value: "سارا" },
    });
    fireEvent.click(screen.getByRole("button", { name: locale === "fa" ? "ذخیره" : "Save" }));
    const error = screen.getByRole("alert");
    const text = error.textContent ?? "";
    expect(text).toContain(`\u2068${requiredField.name}\u2069`);
    expect(text.replace(/[\u2066-\u2069]/g, "")).toBe(
      locale === "fa"
        ? `وارد کردن «${requiredField.name}» الزامی است.`
        : `${requiredField.name} is required`,
    );
    expect(createPerson).not.toHaveBeenCalled();
    expect(updateDeal).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(requiredField.name), { target: { value: "AB۱۲" } });
    fireEvent.click(screen.getByRole("button", { name: locale === "fa" ? "ذخیره" : "Save" }));
    await waitFor(() => expect(updateDeal).toHaveBeenCalledOnce());
    expect(createPerson).toHaveBeenCalledWith(
      expect.objectContaining({ name: "سارا", customFields: { customer_id: "AB۱۲" } }),
      "csrf",
    );
  },
);

it("reuses an already-created person when retrying a failed link", async () => {
  updateDeal.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } });
  const { onError, onDone } = renderEditor("en");
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sara" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onError).toHaveBeenCalledWith("E_PERM_001"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(createPerson).toHaveBeenCalledOnce();
  expect(updateDeal).toHaveBeenCalledTimes(2);
  expect(updateDeal).toHaveBeenLastCalledWith(
    expect.objectContaining({ personId: "created-person" }),
    "csrf",
  );
});
