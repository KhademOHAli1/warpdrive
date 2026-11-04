// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "@/constants/strings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const { report, refresh } = vi.hoisted(() => ({ report: vi.fn(), refresh: vi.fn() }));
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

type Result = { ok: true } | { ok: false; error: { id: string } };
const { setUiFlagAction, setOpenDetailsAfterCreateAction, setScheduleFollowUpAfterWonAction } =
  vi.hoisted(() => ({
    setUiFlagAction: vi.fn((): Promise<Result> => Promise.resolve({ ok: true })),
    setOpenDetailsAfterCreateAction: vi.fn((): Promise<Result> => Promise.resolve({ ok: true })),
    setScheduleFollowUpAfterWonAction: vi.fn((): Promise<Result> => Promise.resolve({ ok: true })),
  }));
vi.mock("@/features/identity/preferencesActions", () => ({
  setUiFlagAction,
  setOpenDetailsAfterCreateAction,
  setScheduleFollowUpAfterWonAction,
}));

beforeEach(() => {
  report.mockClear();
  refresh.mockReset();
  setUiFlagAction.mockReset().mockResolvedValue({ ok: true });
  setOpenDetailsAfterCreateAction.mockReset().mockResolvedValue({ ok: true });
  setScheduleFollowUpAfterWonAction.mockReset().mockResolvedValue({ ok: true });
});

import type { InterfacePrefs } from "@/features/identity/InterfacePrefsProvider";
import { INTERFACE_PREFS_DEFAULT } from "@/features/identity/InterfacePrefsProvider";
import { InterfacePreferences } from "./InterfacePreferences";

const t = STRINGS.settings.interface;

function renderInterface(prefs: InterfacePrefs = INTERFACE_PREFS_DEFAULT, followUp = false): void {
  render(<InterfacePreferences prefs={prefs} scheduleFollowUpAfterWon={followUp} />);
}

function deferred() {
  let resolve!: (result: Result) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Result>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const recoveryCases = [
  { failure: "returned", initial: false },
  { failure: "returned", initial: true },
  { failure: "rejected", initial: false },
  { failure: "rejected", initial: true },
] as const;

const orderingCases = [
  { kind: "flag", failure: "returned" },
  { kind: "flag", failure: "rejected" },
  { kind: "Won", failure: "returned" },
  { kind: "Won", failure: "rejected" },
] as const;

function booleanTarget(kind: "flag" | "Won") {
  const flag = kind === "flag";
  return {
    action: flag ? setUiFlagAction : setScheduleFollowUpAfterWonAction,
    toggle: screen.getByRole("switch", {
      name: flag ? t.winSound : STRINGS.settings.scheduleFollowUpAfterWon,
    }),
    payload: (value: boolean) => (flag ? { key: "winSound", value } : { enabled: value }),
  };
}

async function settleResult(response: ReturnType<typeof deferred>, result: Result): Promise<void> {
  await act(async () => {
    response.resolve(result);
    await response.promise;
  });
}

async function settleFailure(
  response: ReturnType<typeof deferred>,
  failure: "returned" | "rejected",
  id: string,
): Promise<void> {
  await act(async () => {
    if (failure === "returned") response.resolve({ ok: false, error: { id } });
    else response.reject(new Error("private rejected preference write"));
    await response.promise.catch(() => undefined);
  });
}

describe("InterfacePreferences", () => {
  it("optimistically persists a boolean flag toggle", async () => {
    renderInterface();
    const toggle = screen.getByRole("switch", { name: t.usPhoneFormat });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(setUiFlagAction).toHaveBeenCalledWith({ key: "usPhoneFormat", value: true }, "csrf"),
    );
  });

  it("reverts and reports when a flag save fails", async () => {
    setUiFlagAction.mockResolvedValueOnce({ ok: false, error: { id: "E_X" } });
    renderInterface();
    const toggle = screen.getByRole("switch", { name: t.winSound });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(report).toHaveBeenCalledWith("E_X");
  });

  it.each(recoveryCases)(
    "rolls back a $failure flag save from $initial and retries the intended value",
    async ({ failure, initial }) => {
      const failed = deferred();
      setUiFlagAction.mockReturnValueOnce(failed.promise);
      renderInterface({ ...INTERFACE_PREFS_DEFAULT, winSound: initial });
      const toggle = screen.getByRole("switch", { name: t.winSound });
      const unrelated = screen.getByRole("switch", { name: t.usPhoneFormat });
      const unrelatedState = unrelated.getAttribute("aria-checked");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", String(!initial));
      await waitFor(() =>
        expect(setUiFlagAction).toHaveBeenCalledExactlyOnceWith(
          { key: "winSound", value: !initial },
          "csrf",
        ),
      );
      expect(report).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();

      await act(async () => {
        if (failure === "returned") failed.resolve({ ok: false, error: { id: "E_X" } });
        else failed.reject(new Error("private flag transport diagnostic"));
        await failed.promise.catch(() => undefined);
      });
      expect(toggle).toHaveAttribute("aria-checked", String(initial));
      expect(unrelated).toHaveAttribute("aria-checked", unrelatedState);
      expect(report).toHaveBeenCalledTimes(1);
      if (failure === "returned") expect(report).toHaveBeenCalledWith("E_X");
      else expect(report).toHaveBeenCalledWith(undefined);
      expect(refresh).not.toHaveBeenCalled();
      expect(screen.queryByText("private flag transport diagnostic")).not.toBeInTheDocument();

      const retry = deferred();
      setUiFlagAction.mockReturnValueOnce(retry.promise);
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", String(!initial));
      await waitFor(() =>
        expect(setUiFlagAction).toHaveBeenNthCalledWith(
          2,
          { key: "winSound", value: !initial },
          "csrf",
        ),
      );
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => {
        retry.resolve({ ok: true });
        await retry.promise;
      });
      expect(toggle).toHaveAttribute("aria-checked", String(!initial));
      expect(unrelated).toHaveAttribute("aria-checked", unrelatedState);
      expect(setUiFlagAction).toHaveBeenCalledTimes(2);
      expect(report).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(setOpenDetailsAfterCreateAction).not.toHaveBeenCalled();
      expect(setScheduleFollowUpAfterWonAction).not.toHaveBeenCalled();
    },
  );

  it("persists the moved schedule-follow-up toggle via its dedicated action", async () => {
    renderInterface(INTERFACE_PREFS_DEFAULT, false);
    fireEvent.click(
      screen.getByRole("switch", { name: STRINGS.settings.scheduleFollowUpAfterWon }),
    );
    await waitFor(() =>
      expect(setScheduleFollowUpAfterWonAction).toHaveBeenCalledWith({ enabled: true }, "csrf"),
    );
  });

  it.each(recoveryCases)(
    "rolls back a $failure Won follow-up save from $initial and retries the intended value",
    async ({ failure, initial }) => {
      const failed = deferred();
      setScheduleFollowUpAfterWonAction.mockReturnValueOnce(failed.promise);
      renderInterface(INTERFACE_PREFS_DEFAULT, initial);
      const toggle = screen.getByRole("switch", {
        name: STRINGS.settings.scheduleFollowUpAfterWon,
      });
      const unrelated = screen.getByRole("switch", { name: t.scheduleFollowUpAfterDone });
      const unrelatedState = unrelated.getAttribute("aria-checked");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", String(!initial));
      await waitFor(() =>
        expect(setScheduleFollowUpAfterWonAction).toHaveBeenCalledExactlyOnceWith(
          { enabled: !initial },
          "csrf",
        ),
      );
      expect(report).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();

      await act(async () => {
        if (failure === "returned") failed.resolve({ ok: false, error: { id: "E_X" } });
        else failed.reject(new Error("private follow-up transport diagnostic"));
        await failed.promise.catch(() => undefined);
      });
      expect(toggle).toHaveAttribute("aria-checked", String(initial));
      expect(unrelated).toHaveAttribute("aria-checked", unrelatedState);
      expect(report).toHaveBeenCalledTimes(1);
      if (failure === "returned") expect(report).toHaveBeenCalledWith("E_X");
      else expect(report).toHaveBeenCalledWith(undefined);
      expect(refresh).not.toHaveBeenCalled();
      expect(screen.queryByText("private follow-up transport diagnostic")).not.toBeInTheDocument();

      const retry = deferred();
      setScheduleFollowUpAfterWonAction.mockReturnValueOnce(retry.promise);
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", String(!initial));
      await waitFor(() =>
        expect(setScheduleFollowUpAfterWonAction).toHaveBeenNthCalledWith(
          2,
          { enabled: !initial },
          "csrf",
        ),
      );
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => {
        retry.resolve({ ok: true });
        await retry.promise;
      });
      expect(toggle).toHaveAttribute("aria-checked", String(!initial));
      expect(unrelated).toHaveAttribute("aria-checked", unrelatedState);
      expect(setScheduleFollowUpAfterWonAction).toHaveBeenCalledTimes(2);
      expect(report).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(setUiFlagAction).not.toHaveBeenCalled();
      expect(setOpenDetailsAfterCreateAction).not.toHaveBeenCalled();
    },
  );

  it("persists the schedule-follow-up-after-done toggle as a generic flag, right under the Won row", async () => {
    renderInterface();
    const toggle = screen.getByRole("switch", { name: t.scheduleFollowUpAfterDone });
    const switches = screen.getAllByRole("switch");
    expect(switches.indexOf(toggle)).toBe(1);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(setUiFlagAction).toHaveBeenCalledWith(
        { key: "scheduleFollowUpAfterDone", value: true },
        "csrf",
      ),
    );
  });

  it.each(orderingCases)(
    "keeps newest $kind intent and ordered writes when the first request is $failure",
    async ({ kind, failure }) => {
      renderInterface();
      const { action, toggle, payload } = booleanTarget(kind);
      const first = deferred();
      const second = deferred();
      const third = deferred();
      action
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockReturnValueOnce(third.promise);
      fireEvent.click(toggle);
      await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(action).toHaveBeenCalledTimes(1);
      expect(action).toHaveBeenNthCalledWith(1, payload(true), "csrf");

      await settleFailure(first, failure, "E_OLD");
      await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
      expect(action).toHaveBeenNthCalledWith(2, payload(false), "csrf");
      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(report).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();

      await settleResult(second, { ok: true });
      await waitFor(() => expect(action).toHaveBeenCalledTimes(3));
      expect(action).toHaveBeenNthCalledWith(3, payload(true), "csrf");
      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(report).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      await settleResult(third, { ok: true });
      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(report).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it.each(orderingCases)(
    "rolls a newest $failure $kind failure back to the last acknowledgement",
    async ({ kind, failure }) => {
      renderInterface();
      const { action, toggle, payload } = booleanTarget(kind);
      const first = deferred();
      const second = deferred();
      const third = deferred();
      action
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockReturnValueOnce(third.promise);
      fireEvent.click(toggle);
      await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(action).toHaveBeenCalledTimes(1);

      await settleResult(first, { ok: true });
      await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
      expect(action).toHaveBeenNthCalledWith(2, payload(false), "csrf");
      expect(refresh).not.toHaveBeenCalled();
      await settleFailure(second, "returned", "E_OLD");
      await waitFor(() => expect(action).toHaveBeenCalledTimes(3));
      expect(action).toHaveBeenNthCalledWith(3, payload(true), "csrf");
      expect(report).not.toHaveBeenCalled();
      await settleFailure(third, failure, "E_NEW");

      // The first true write is durable; neither failed write may roll back past it.
      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(report).toHaveBeenCalledTimes(1);
      if (failure === "returned") expect(report).toHaveBeenCalledWith("E_NEW");
      else expect(report).toHaveBeenCalledWith(undefined);
      expect(refresh).not.toHaveBeenCalled();
      expect(action).toHaveBeenCalledTimes(3);
    },
  );

  it("allows different flags and Won to save without waiting for another flag's queue", async () => {
    const sound = deferred();
    setUiFlagAction.mockReturnValueOnce(sound.promise).mockResolvedValue({ ok: true });
    renderInterface();
    const soundToggle = screen.getByRole("switch", { name: t.winSound });
    const phoneToggle = screen.getByRole("switch", { name: t.usPhoneFormat });
    const wonToggle = screen.getByRole("switch", {
      name: STRINGS.settings.scheduleFollowUpAfterWon,
    });
    fireEvent.click(soundToggle);
    await waitFor(() => expect(setUiFlagAction).toHaveBeenCalledTimes(1));
    fireEvent.click(phoneToggle);
    fireEvent.click(wonToggle);
    await waitFor(() => expect(setUiFlagAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(setScheduleFollowUpAfterWonAction).toHaveBeenCalledTimes(1));
    expect(setUiFlagAction).toHaveBeenNthCalledWith(
      2,
      { key: "usPhoneFormat", value: true },
      "csrf",
    );
    expect(phoneToggle).toHaveAttribute("aria-checked", "true");
    expect(wonToggle).toHaveAttribute("aria-checked", "true");
    await settleFailure(sound, "rejected", "E_SOUND");
    expect(soundToggle).toHaveAttribute("aria-checked", "false");
    expect(phoneToggle).toHaveAttribute("aria-checked", "true");
    expect(wonToggle).toHaveAttribute("aria-checked", "true");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      kind: "flag",
      action: setUiFlagAction,
      firstLabel: t.winSound,
      secondLabel: t.winSound,
      firstInput: { key: "winSound", value: true },
      secondInput: { key: "winSound", value: false },
      secondValue: false,
    },
    {
      kind: "Won",
      action: setScheduleFollowUpAfterWonAction,
      firstLabel: STRINGS.settings.scheduleFollowUpAfterWon,
      secondLabel: STRINGS.settings.scheduleFollowUpAfterWon,
      firstInput: { enabled: true },
      secondInput: { enabled: false },
      secondValue: false,
    },
    {
      kind: "open-details",
      action: setOpenDetailsAfterCreateAction,
      firstLabel: t.openDetailsPerson,
      secondLabel: t.openDetailsOrg,
      firstInput: { leadDeal: false, person: true, org: false },
      secondInput: { leadDeal: false, person: true, org: true },
      secondValue: true,
    },
  ])("keeps acknowledged $kind writes and its queue usable after refresh throws", async (entry) => {
    refresh.mockImplementationOnce(() => {
      throw new Error("refresh interrupted");
    });
    renderInterface();
    const first = screen.getByRole("switch", { name: entry.firstLabel });
    const second = screen.getByRole("switch", { name: entry.secondLabel });
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(entry.action).toHaveBeenNthCalledWith(1, entry.firstInput, "csrf");
    expect(report).not.toHaveBeenCalled();
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-checked", String(entry.secondValue));
    await waitFor(() => expect(entry.action).toHaveBeenCalledTimes(2));
    expect(entry.action).toHaveBeenNthCalledWith(2, entry.secondInput, "csrf");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(second).toHaveAttribute("aria-checked", String(entry.secondValue));
    expect(report).not.toHaveBeenCalled();
  });

  it("toggling the parent open-details switch sets all three entities", async () => {
    renderInterface();
    const parent = screen.getByRole("switch", { name: t.openDetailsAfterCreate });
    fireEvent.click(parent);
    await waitFor(() =>
      expect(setOpenDetailsAfterCreateAction).toHaveBeenCalledWith(
        { leadDeal: true, person: true, org: true },
        "csrf",
      ),
    );
  });

  it("parent switch is on only when all three children are on", () => {
    renderInterface({
      ...INTERFACE_PREFS_DEFAULT,
      openDetailsAfterCreate: { leadDeal: true, person: true, org: true },
    });
    expect(screen.getByRole("switch", { name: t.openDetailsAfterCreate })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("toggling one child persists the whole object", async () => {
    renderInterface();
    fireEvent.click(screen.getByRole("switch", { name: t.openDetailsPerson }));
    await waitFor(() =>
      expect(setOpenDetailsAfterCreateAction).toHaveBeenCalledWith(
        { leadDeal: false, person: true, org: false },
        "csrf",
      ),
    );
  });

  it("preserves every open-details change when children are toggled in one render", async () => {
    renderInterface();
    const leadDeal = screen.getByRole("switch", { name: t.openDetailsLeadDeal });
    const person = screen.getByRole("switch", { name: t.openDetailsPerson });
    const org = screen.getByRole("switch", { name: t.openDetailsOrg });

    act(() => {
      leadDeal.click();
      person.click();
      org.click();
    });

    await waitFor(() => expect(setOpenDetailsAfterCreateAction).toHaveBeenCalledTimes(3));
    expect(setOpenDetailsAfterCreateAction).toHaveBeenNthCalledWith(
      1,
      { leadDeal: true, person: false, org: false },
      "csrf",
    );
    expect(setOpenDetailsAfterCreateAction).toHaveBeenNthCalledWith(
      2,
      { leadDeal: true, person: true, org: false },
      "csrf",
    );
    expect(setOpenDetailsAfterCreateAction).toHaveBeenNthCalledWith(
      3,
      { leadDeal: true, person: true, org: true },
      "csrf",
    );
    expect(screen.getByRole("switch", { name: t.openDetailsAfterCreate })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
