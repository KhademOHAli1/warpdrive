// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { err, ok } from "@/types/result";
import { InlineDateField } from "./InlineDateField";
import { InlineTextField } from "./InlineTextField";
import { saveErrorMessage } from "./saveError";

afterEach(cleanup);

it("recaptures the input locale after canceling an earlier numeric draft", () => {
  const onSave = vi.fn(() => Promise.resolve(ok(undefined)));
  const tree = (locale: Locale) => (
    <LocaleProvider locale={locale}>
      <InlineTextField label="Amount" value="10" onSave={onSave} />
    </LocaleProvider>
  );
  const view = render(tree("de"));
  fireEvent.click(screen.getByRole("button", { name: "Amount bearbeiten" }));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1,234" } });
  fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
  view.rerender(tree("en"));
  fireEvent.click(screen.getByRole("button", { name: "Edit Amount" }));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1,234" } });
  fireEvent.keyDown(screen.getByLabelText("Amount"), { key: "Enter" });
  expect(onSave).toHaveBeenCalledWith("1,234", "en");
});

it("localizes inline actions and retains caller-reviewed validation messages", async () => {
  render(
    <LocaleProvider locale="fa">
      <InlineTextField
        label="تعداد کارکنان"
        value="10"
        onSave={() => Promise.resolve(err("count"))}
        formatError={(error) =>
          error === "count" ? "تعداد کارکنان باید یک عدد صحیح باشد." : undefined
        }
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "ویرایش تعداد کارکنان" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
  expect(await screen.findByText("تعداد کارکنان باید یک عدد صحیح باشد.")).toBeInTheDocument();
  expect(saveErrorMessage("E_PERM_001", "fa")).toContain("اجازه");
  expect(saveErrorMessage("unknown", "fa")).toBe("ذخیره نشد");
});

it("shows inline civil dates using the selected Iranian calendar", () => {
  render(
    <LocaleProvider locale="fa">
      <InlineDateField
        label="تاریخ"
        value="2026-03-21"
        onSave={() => Promise.resolve(err("error"))}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText(/۱۴۰۵/)).toBeInTheDocument();
  expect(screen.queryByText("03/21/2026")).not.toBeInTheDocument();
});
