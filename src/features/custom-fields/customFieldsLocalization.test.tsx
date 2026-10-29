// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";
import { CustomFieldCreateFields, customFieldCreateError } from "./CustomFieldCreateFields";
import { InlineCustomFieldEditor } from "./InlineCustomFieldEditor";
import { CustomFieldDetail, CustomFieldFormControl } from "./render.widgets";

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    identity: { assignableUsers: { useQuery: () => ({ data: [], isLoading: false }) } },
    contacts: {
      personOptions: { useQuery: () => ({ data: [], isLoading: false }) },
      orgOptions: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);
const def = (over: Partial<CustomFieldDef> = {}): CustomFieldDef => ({
  id: "cf-n",
  key: "admin_numeric_key",
  targetEntity: "deal",
  type: "numeric",
  name: "تعداد تماس",
  options: [],
  isRequired: false,
  isImportant: false,
  showInAddForm: true,
  order: 0,
  archivedAt: null,
  ...over,
});
describe("Persian custom fields", () => {
  it("formats numbers and Persian calendar dates without modifying stored values", () => {
    const date = "2026-03-21";
    render(
      <LocaleProvider locale="fa">
        <CustomFieldDetail def={def()} value={1234.5} />
        <CustomFieldDetail def={def({ type: "date", key: "date" })} value={date} />
      </LocaleProvider>,
    );
    expect(screen.getByText("۱٬۲۳۴٫۵")).toBeInTheDocument();
    expect(screen.getByText(/۱۴۰۵/)).toBeInTheDocument();
    expect(date).toBe("2026-03-21");
  });
  it("keeps the currency and administrator-defined field labels", () => {
    render(
      <LocaleProvider locale="fa">
        <CustomFieldDetail
          def={def({ type: "monetary", name: "Budget" })}
          value={12.5}
          currency="EUR"
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(/۱۲٫۵/)).toHaveTextContent("€");
  });
  it("normalizes Persian numeric input into a canonical number", () => {
    const change = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <CustomFieldFormControl def={def()} value={null} onChange={change} />
      </LocaleProvider>,
    );
    const input = screen.getByLabelText("تعداد تماس");
    fireEvent.change(input, { target: { value: "۱٬۲۳۴٫۵" } });
    expect(change).toHaveBeenLastCalledWith(1234.5);
    expect(input).toHaveAttribute("inputmode", "decimal");
  });
  it("keeps malformed numeric drafts out of the inline save boundary", () => {
    const save = vi.fn();
    render(
      <LocaleProvider locale="fa">
        <InlineCustomFieldEditor def={def()} value={5} currency="USD" onSave={save} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ویرایش تعداد تماس" }));
    fireEvent.change(screen.getByLabelText("تعداد تماس"), { target: { value: "۱٬۲۳" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(screen.getByRole("alert")).toHaveTextContent("یک عدد معتبر");
    expect(save).not.toHaveBeenCalled();
  });
  it("renders a localized error when a valid inline save is rejected", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, error: "E_PERM_001" });
    render(
      <LocaleProvider locale="fa">
        <InlineCustomFieldEditor def={def()} value={5} currency="USD" onSave={save} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ویرایش تعداد تماس" }));
    fireEvent.change(screen.getByLabelText("تعداد تماس"), { target: { value: "۷" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/اجازه/));
    expect(save).toHaveBeenCalledWith(7);
  });
  it("localizes the required marker and heading without translating the admin name", () => {
    render(
      <LocaleProvider locale="fa">
        <CustomFieldCreateFields
          defs={[def({ name: "My Label", isRequired: true })]}
          values={{}}
          onChange={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText("فیلدهای سفارشی")).toBeInTheDocument();
    expect(screen.getByText("My Label")).toHaveTextContent("My Label");
    expect(screen.getByText("(الزامی)")).toBeInTheDocument();
  });
});

it("keeps administrator option labels and emits the stored option ID", () => {
  const change = vi.fn();
  render(
    <LocaleProvider locale="fa">
      <CustomFieldFormControl
        def={def({
          type: "single_option",
          name: "Sector",
          key: "sector",
          options: [{ id: "saas-id", label: "SaaS / نرم‌افزار" }],
        })}
        value=""
        onChange={change}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByLabelText("Sector"));
  fireEvent.click(screen.getByRole("option", { name: "SaaS / نرم‌افزار" }));
  expect(change).toHaveBeenCalledWith("saas-id");
});
it("uses the localized time control while keeping range storage as ASCII HH:mm", () => {
  const change = vi.fn();
  render(
    <LocaleProvider locale="fa">
      <CustomFieldFormControl
        def={def({ type: "time_range", name: "بازه", key: "range" })}
        value={{ start: "09:00", end: "17:00" }}
        onChange={change}
      />
    </LocaleProvider>,
  );
  const start = screen.getByLabelText("شروع بازه");
  fireEvent.change(start, { target: { value: "۱۰۳۰" } });
  fireEvent.blur(start);
  expect(change).toHaveBeenCalledWith({ start: "10:30", end: "17:00" });
});

it("validates create drafts before any entity-creation side effects without changing values", () => {
  const values = { admin_numeric_key: "۱٬۲۳" };
  expect(customFieldCreateError([def()], values, "fa")).toContain("یک عدد معتبر");
  expect(values).toEqual({ admin_numeric_key: "۱٬۲۳" });
  expect(customFieldCreateError([def()], {}, "fa")).toBeNull();
});

it("reports the existing monetary precision boundary without rounding or changing input", () => {
  const values = { admin_numeric_key: "۱۲٫۳۴۵" };
  expect(customFieldCreateError([def({ type: "monetary" })], values, "fa")).toContain(
    "دو رقم اعشار",
  );
  expect(values.admin_numeric_key).toBe("۱۲٫۳۴۵");
});

it("does not manually save a stale custom time while an invalid raw time is shown", () => {
  const onSave = vi.fn(() => Promise.resolve({ ok: true as const, value: {} }));
  render(
    <LocaleProvider locale="fa">
      <InlineCustomFieldEditor
        def={def({ type: "time", key: "time", name: "زمان پیگیری" })}
        value="08:00"
        currency="USD"
        onSave={onSave}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "ویرایش زمان پیگیری" }));
  const input = screen.getByLabelText("زمان پیگیری");
  fireEvent.change(input, { target: { value: "09:00" } });
  fireEvent.blur(input);
  fireEvent.change(input, { target: { value: "99:99" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(input).toHaveValue("99:99");
  expect(screen.getByRole("alert")).toHaveTextContent("ساعت معتبری");
  fireEvent.change(input, { target: { value: "10:00" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
  expect(onSave).toHaveBeenCalledWith("10:00");
});
