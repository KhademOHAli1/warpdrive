// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "@/constants/strings";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { NumberingSystem } from "@/lib/numberingSystem";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const report = vi.hoisted(() => vi.fn());
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

type Result = { ok: true } | { ok: false; error: { id: string } };
const { setDailyActivityTargetAction } = vi.hoisted(() => ({
  setDailyActivityTargetAction: vi.fn((): Promise<Result> => Promise.resolve({ ok: true })),
}));
vi.mock("@/features/identity/preferencesActions", () => ({ setDailyActivityTargetAction }));

const { invalidateDayLoad } = vi.hoisted(() => ({
  invalidateDayLoad: vi.fn((): Promise<void> => Promise.resolve()),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      activities: {
        dayLoad: { invalidate: invalidateDayLoad },
        listRows: { invalidate: () => Promise.resolve() },
      },
    }),
  },
}));

import { DailyActivityTarget } from "./DailyActivityTarget";

const t = STRINGS.settings.dailyActivityTarget;

function renderTarget(
  target = 5,
  locale: Locale = "en",
  numberingSystem?: NumberingSystem,
): HTMLInputElement {
  render(
    <LocaleProvider locale={locale} numberingSystem={numberingSystem}>
      <DailyActivityTarget target={target} />
    </LocaleProvider>,
  );
  return screen.getByLabelText(locale === "fa" ? "تعداد فعالیت در روز" : t.label);
}

function deferred(): { promise: Promise<Result>; resolve: (r: Result) => void } {
  let settle: (r: Result) => void = () => {};
  const promise = new Promise<Result>((res) => {
    settle = res;
  });
  return { promise, resolve: (r) => settle(r) };
}

function commitValue(field: HTMLInputElement, value: string): void {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

describe("DailyActivityTarget", () => {
  it.each([
    { raw: "7,0", saved: 7 },
    { raw: "0.020", saved: 20 },
  ])("parses a German whole-number draft $raw", async ({ raw, saved }) => {
    render(
      <LocaleProvider locale="de">
        <DailyActivityTarget target={5} />
      </LocaleProvider>,
    );
    commitValue(screen.getByRole("textbox"), raw);
    await waitFor(() =>
      expect(setDailyActivityTargetAction).toHaveBeenCalledWith({ target: saved }, "csrf"),
    );
  });
  it("rejects a grouped German target outside the limit instead of reading it as a decimal", () => {
    render(
      <LocaleProvider locale="de">
        <DailyActivityTarget target={5} />
      </LocaleProvider>,
    );
    commitValue(screen.getByRole("textbox"), "1.000");
    expect(setDailyActivityTargetAction).not.toHaveBeenCalled();
  });
  it("does not reinterpret an active German target draft after switching languages", async () => {
    const view = render(
      <LocaleProvider locale="de">
        <DailyActivityTarget target={5} />
      </LocaleProvider>,
    );
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "7,0" } });
    view.rerender(
      <LocaleProvider locale="en">
        <DailyActivityTarget target={5} />
      </LocaleProvider>,
    );
    fireEvent.blur(field);
    await waitFor(() =>
      expect(setDailyActivityTargetAction).toHaveBeenCalledWith({ target: 7 }, "csrf"),
    );
  });
  it.each<{ numberingSystem?: NumberingSystem; initial: string; committed: string }>([
    { initial: "۵", committed: "۹" },
    { numberingSystem: "latn", initial: "5", committed: "9" },
  ])(
    "uses the chosen $numberingSystem digits before and after committing normalized input",
    async ({ numberingSystem, initial, committed }) => {
      const field = renderTarget(5, "fa", numberingSystem);
      expect(field).toHaveValue(initial);
      fireEvent.change(field, { target: { value: "٩" } });
      expect(field).toHaveValue("٩");
      fireEvent.blur(field);
      await waitFor(() =>
        expect(setDailyActivityTargetAction).toHaveBeenCalledWith({ target: 9 }, "csrf"),
      );
      expect(field).toHaveValue(committed);
    },
  );

  it.each<{ numberingSystem?: NumberingSystem; saved: string }>([
    { saved: "۵" },
    { numberingSystem: "latn", saved: "5" },
  ])(
    "restores $numberingSystem display after an invalid draft or failed save",
    async ({ numberingSystem, saved }) => {
      const field = renderTarget(5, "fa", numberingSystem);
      fireEvent.change(field, { target: { value: "۱۲x" } });
      expect(field).toHaveValue("۱۲x");
      fireEvent.blur(field);
      expect(field).toHaveValue(saved);
      expect(setDailyActivityTargetAction).not.toHaveBeenCalled();

      setDailyActivityTargetAction.mockResolvedValueOnce({ ok: false, error: { id: "E_X" } });
      commitValue(field, "۹");
      await waitFor(() => expect(report).toHaveBeenCalledWith("E_X"));
      expect(field).toHaveValue(saved);
    },
  );

  it("preserves an unfinished draft across a number-display change, then resets in the new style", () => {
    const view = render(
      <LocaleProvider locale="fa" numberingSystem="arabext">
        <DailyActivityTarget target={5} />
      </LocaleProvider>,
    );
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "۱۲x" } });
    view.rerender(
      <LocaleProvider locale="fa" numberingSystem="latn">
        <DailyActivityTarget target={5} />
      </LocaleProvider>,
    );
    expect(field).toHaveValue("۱۲x");
    fireEvent.blur(field);
    expect(field).toHaveValue("5");
    expect(setDailyActivityTargetAction).not.toHaveBeenCalled();
  });

  it("renders the current target", () => {
    expect(renderTarget(8)).toHaveValue("8");
  });

  it("persists a changed value on blur", async () => {
    const field = renderTarget(5);
    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(setDailyActivityTargetAction).toHaveBeenCalledWith({ target: 9 }, "csrf"),
    );
    expect(field).toHaveValue("9");
  });

  it("persists a changed value on Enter", async () => {
    const field = renderTarget(5);
    fireEvent.change(field, { target: { value: "12" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(setDailyActivityTargetAction).toHaveBeenCalledWith({ target: 12 }, "csrf"),
    );
  });

  it("reverts and reports the error when the save fails", async () => {
    setDailyActivityTargetAction.mockResolvedValueOnce({ ok: false, error: { id: "E_X" } });
    const field = renderTarget(5);
    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.blur(field);
    await waitFor(() => expect(field).toHaveValue("5"));
    expect(report).toHaveBeenCalledWith("E_X");
  });

  it("invalidates the day load so pickers recolour against the saved target", async () => {
    const field = renderTarget(5);
    commitValue(field, "9");
    await waitFor(() => expect(invalidateDayLoad).toHaveBeenCalledTimes(1));
  });

  it("invalidates for a save that succeeded even when the commit after it fails", async () => {
    const first = deferred();
    setDailyActivityTargetAction.mockReturnValueOnce(first.promise);
    setDailyActivityTargetAction.mockResolvedValueOnce({ ok: false, error: { id: "E_X" } });
    const field = renderTarget(5);
    commitValue(field, "9");
    commitValue(field, "12");
    first.resolve({ ok: true });
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_X"));
    expect(invalidateDayLoad).toHaveBeenCalledTimes(1);
    expect(field).toHaveValue("9");
  });

  it("leaves the day load alone when the save fails", async () => {
    setDailyActivityTargetAction.mockResolvedValueOnce({ ok: false, error: { id: "E_X" } });
    const field = renderTarget(5);
    commitValue(field, "9");
    await waitFor(() => expect(report).toHaveBeenCalledWith("E_X"));
    expect(invalidateDayLoad).not.toHaveBeenCalled();
  });

  it("does not hold the next queued save behind an unsettled invalidation", async () => {
    invalidateDayLoad.mockImplementationOnce(() => new Promise<void>(() => {}));
    const field = renderTarget(5);
    commitValue(field, "9");
    await waitFor(() => expect(setDailyActivityTargetAction).toHaveBeenCalledTimes(1));
    commitValue(field, "12");
    await waitFor(() => expect(setDailyActivityTargetAction).toHaveBeenCalledTimes(2));
    expect(field).toHaveValue("12");
  });

  it("does not call the action when the value is unchanged", () => {
    const field = renderTarget(5);
    fireEvent.change(field, { target: { value: "5" } });
    fireEvent.blur(field);
    expect(setDailyActivityTargetAction).not.toHaveBeenCalled();
  });

  it("clamps an out-of-range entry back instead of persisting it", () => {
    const field = renderTarget(5);
    fireEvent.change(field, { target: { value: "999" } });
    fireEvent.blur(field);
    expect(setDailyActivityTargetAction).not.toHaveBeenCalled();
    expect(field).toHaveValue("5");
  });

  it("clamps a fractional entry back instead of persisting it", () => {
    const field = renderTarget(5);
    fireEvent.change(field, { target: { value: "2.5" } });
    fireEvent.blur(field);
    expect(setDailyActivityTargetAction).not.toHaveBeenCalled();
    expect(field).toHaveValue("5");
  });

  it("keeps the newer value when an earlier save fails after a later commit", async () => {
    const first = deferred();
    const second = deferred();
    setDailyActivityTargetAction
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const field = renderTarget(5);
    commitValue(field, "9");
    await waitFor(() => expect(setDailyActivityTargetAction).toHaveBeenCalledTimes(1));

    commitValue(field, "12");
    first.resolve({ ok: false, error: { id: "E_X" } });
    second.resolve({ ok: true });

    await waitFor(() => expect(setDailyActivityTargetAction).toHaveBeenCalledTimes(2));
    expect(setDailyActivityTargetAction).toHaveBeenLastCalledWith({ target: 12 }, "csrf");
    expect(field).toHaveValue("12");
    expect(report).not.toHaveBeenCalled();
  });

  it("sends overlapping saves in commit order so the last commit is persisted last", async () => {
    const first = deferred();
    setDailyActivityTargetAction.mockImplementationOnce(() => first.promise);
    const field = renderTarget(5);
    commitValue(field, "9");
    await waitFor(() => expect(setDailyActivityTargetAction).toHaveBeenCalledTimes(1));

    commitValue(field, "12");
    await Promise.resolve();
    await Promise.resolve();
    expect(setDailyActivityTargetAction).toHaveBeenCalledTimes(1);

    first.resolve({ ok: true });
    await waitFor(() => expect(setDailyActivityTargetAction).toHaveBeenCalledTimes(2));
    expect(setDailyActivityTargetAction).toHaveBeenNthCalledWith(1, { target: 9 }, "csrf");
    expect(setDailyActivityTargetAction).toHaveBeenNthCalledWith(2, { target: 12 }, "csrf");
    expect(field).toHaveValue("12");
  });
});
