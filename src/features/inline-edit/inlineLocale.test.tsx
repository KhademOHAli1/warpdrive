// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { err } from "@/types/result";
import { InlineDateField } from "./InlineDateField";
import { InlineTextField } from "./InlineTextField";
import { saveErrorMessage } from "./saveError";

afterEach(cleanup);

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
