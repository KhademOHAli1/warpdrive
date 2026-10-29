// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { StageEditCard } from "./StageEditCard";

afterEach(cleanup);

it("edits a stage through Persian labels while preserving the user's stage name", () => {
  const onChange = vi.fn();
  render(
    <LocaleProvider locale="fa">
      <StageEditCard
        row={{
          id: "s",
          name: "Qualified",
          rottingDays: null,
          dealCount: 0,
          closedDealCount: 0,
        }}
        index={0}
        canDelete
        onChange={onChange}
        onDelete={vi.fn()}
      />
    </LocaleProvider>,
  );
  const name = screen.getByLabelText("نام مرحلهٔ ۱");
  expect(name).toHaveValue("Qualified");
  fireEvent.change(name, { target: { value: "ارزیابی اولیه" } });
  expect(onChange).toHaveBeenCalledWith({ name: "ارزیابی اولیه" });
});

it("accepts Persian digits for the stage inactivity threshold", () => {
  const onChange = vi.fn();
  render(
    <LocaleProvider locale="fa">
      <StageEditCard
        row={{ id: "s", name: "Qualified", rottingDays: 4, dealCount: 0, closedDealCount: 0 }}
        index={0}
        canDelete
        onChange={onChange}
        onDelete={vi.fn()}
      />
    </LocaleProvider>,
  );
  const threshold = screen.getByLabelText("مهلت توقف در مرحلهٔ ۱ بر حسب روز");
  fireEvent.change(threshold, { target: { value: "۱۴" } });
  expect(onChange).toHaveBeenCalledWith({ rottingDays: 14 });
});
