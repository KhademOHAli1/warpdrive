// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ok } from "@/types/result";
import {
  CASE_ID,
  confirm,
  currentCase,
  labels,
  loaded,
  mocks,
  refresh,
  showCase,
} from "./__fixtures__/OwnPrivacyCaseStatusTestKit";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(ok(currentCase));
  mocks.verify.mockResolvedValue(ok({ ...currentCase, version: 4 }));
  mocks.workflow.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test.each([
  ["under_review", "Under review"],
  ["closed", "Closed"],
] as const)(
  "an uncertain confirmation retains its exact retry after the case advances to %s",
  async (status, label) => {
    const commandId = "00000000-0000-4000-8000-000000000033";
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue(commandId);
    const advanced = { ...currentCase, status, version: 12 };
    const latest = { ...advanced, version: 13, dueAt: new Date("2026-04-21T00:30:00Z") };
    mocks.read
      .mockResolvedValueOnce(ok(currentCase))
      .mockResolvedValueOnce(ok(advanced))
      .mockResolvedValueOnce(ok(latest));
    mocks.verify.mockRejectedValueOnce(new Error("Synthetic lost acknowledgement"));
    const { view } = showCase();
    await loaded();
    confirm();
    await waitFor(
      () => expect(screen.getByRole("button", { name: labels.en.retry })).not.toBeDisabled(),
      { timeout: 1000 },
    );
    const original = { caseId: CASE_ID, expectedVersion: 3, commandId };
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledWith("csrf", original);
    refresh();
    await screen.findByText(label, {}, { timeout: 1000 });
    await waitFor(
      () => expect(screen.getByRole("button", { name: labels.en.refresh })).not.toBeDisabled(),
      { timeout: 1000 },
    );
    const retry = await screen.findByRole("button", { name: labels.en.retry }, { timeout: 1000 });
    expect(retry).not.toBeDisabled();
    fireEvent.click(retry);
    await screen.findByText(labels.en.recorded, {}, { timeout: 1000 });
    await waitFor(
      () => expect(screen.getByRole("button", { name: labels.en.refresh })).not.toBeDisabled(),
      { timeout: 1000 },
    );
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(mocks.verify).toHaveBeenNthCalledWith(2, "csrf", original);
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      view.container.querySelector(`time[datetime="${latest.dueAt.toISOString()}"]`),
    ).not.toBeNull();
    expect(screen.queryByText(labels.en.received)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: labels.en.confirm })).not.toBeInTheDocument();
  },
);
