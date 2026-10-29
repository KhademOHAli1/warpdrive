// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

it("uses a Farsi default cancel action while retaining caller-authored copy", () => {
  render(
    <LocaleProvider locale="fa">
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="بررسی تغییر"
        description="متن تأیید"
        confirmLabel="تأیید"
        onConfirm={() => {}}
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole("button", { name: "انصراف" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "تأیید" })).toBeInTheDocument();
});
